/**
 * Jenkins Parallel Job PoC
 *
 * Tests whether Jenkins allows triggering multiple jobs of the same type in parallel.
 *
 * Key findings from research:
 * - Jenkins does NOT limit jobs per user - it limits by "executors"
 * - Same job CAN run concurrently if "Execute concurrent builds if necessary" is enabled
 * - Jobs with different parameters can run in parallel on the same job type
 *
 * Usage:
 *   node scripts/jenkins-parallel-poc.js
 *
 * Requires JENKINS_USERNAME and JENKINS_TOKEN in .dev.vars
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .dev.vars
function loadDevVars() {
  const devVarsPath = join(__dirname, "..", ".dev.vars");
  const content = readFileSync(devVarsPath, "utf-8");
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length > 0) {
      vars[key.trim()] = rest.join("=").trim();
    }
  }
  return vars;
}

const devVars = loadDevVars();
const JENKINS_USERNAME = devVars.JENKINS_USERNAME;
const JENKINS_TOKEN = devVars.JENKINS_TOKEN;
const JENKINS_BASE_URL = devVars.JENKINS_BASE_URL || "https://jenkins.example.com";
const JOB_NAME = devVars.JENKINS_JOB_NAME || "TESTER-EXECUTE-QUERY";

/**
 * Get Jenkins crumb for CSRF protection
 */
async function getCrumb(baseUrl, username, token) {
  const crumbUrl = `${baseUrl}/crumbIssuer/api/json`;
  try {
    const response = await fetch(crumbUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
      },
    });
    if (response.ok) {
      const data = await response.json();
      return {
        field: data.crumbRequestField,
        value: data.crumb,
      };
    }
  } catch (e) {
    console.log("Crumb issuer not available (may not be required):", e.message);
  }
  return null;
}

/**
 * Fetch environment choices from a Jenkins job
 */
async function getEnvChoices(baseUrl, job, username, token) {
  const url = `${baseUrl}/job/${job}/api/json`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch job info: HTTP ${response.status}`);
  }

  const data = await response.json();
  const choices = [];

  if (data.property) {
    for (const prop of data.property) {
      if (prop.parameterDefinitions) {
        for (const def of prop.parameterDefinitions) {
          if (def._class === "hudson.model.ChoiceParameterDefinition" && (def.name === "ENV" || def.name === "ENVIRONMENT")) {
            choices.push(...(def.choices || []));
          }
        }
      }
    }
  }

  return choices;
}

/**
 * Trigger a Jenkins job with parameters
 * Returns the queue URL for polling
 */
async function triggerJob(baseUrl, job, env, sqlText, username, token, jobIndex) {
  const url = `${baseUrl}/job/${job}/buildWithParameters`;
  const crumb = await getCrumb(baseUrl, username, token);

  // Create form data
  const formData = new FormData();
  formData.append("ENV", env);

  // Create a unique filename for each parallel job
  // IMPORTANT: The SQL content MUST be different for each job to avoid "Queue item exists"
  const timestamp = Date.now();
  const uniqueId = Math.random().toString(36).substring(2, 10);
  const filename = `parallel_poc_job${jobIndex}_${timestamp}_${uniqueId}.sql`;

  // Add unique comment to SQL to ensure different content
  const uniqueSql = `-- Job ${jobIndex} | ${timestamp} | ${uniqueId}\n${sqlText}`;
  const sqlBlob = new Blob([uniqueSql], { type: "application/sql" });
  formData.append("INPUT_FILE", sqlBlob, filename);

  const headers = {
    Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
  };

  if (crumb) {
    headers[crumb.field] = crumb.value;
  }

  console.log(`[Job ${jobIndex}] Triggering job with env=${env}...`);
  const startTime = Date.now();

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  const statusCode = response.status;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`[Job ${jobIndex}] Trigger failed: HTTP ${statusCode} - ${body.slice(0, 300)}`);
  }

  let location = response.headers.get("Location");

  // Handle "Queue item exists" response - Jenkins returns 200 with a message
  // when the same job is already queued (concurrent builds not enabled)
  if (!location) {
    const body = await response.text().catch(() => "");

    // Check if this is the "Queue item exists" response
    const queueMatch = body.match(/\/queue\/item\/(\d+)/);
    if (queueMatch) {
      const existingQueueItem = queueMatch[0];
      console.log(`[Job ${jobIndex}] ⚠️  Queue item already exists: ${existingQueueItem}`);
      console.log(`[Job ${jobIndex}] This means "Execute concurrent builds" is NOT enabled on this job.`);

      // Return the existing queue URL - all jobs will share the same build
      location = `${baseUrl.replace(/\/$/, "")}${existingQueueItem}/`;
    } else {
      const hdrs = {};
      response.headers.forEach((v, k) => (hdrs[k] = v));
      console.log(`[Job ${jobIndex}] HTTP ${statusCode} - Headers:`, JSON.stringify(hdrs, null, 2));
      console.log(`[Job ${jobIndex}] Body (first 500 chars):`, body.slice(0, 500));
      throw new Error(`[Job ${jobIndex}] Missing Location header (HTTP ${statusCode})`);
    }
  }

  const queueUrl = `${location.replace(/\/$/, "")}/api/json`;
  console.log(`[Job ${jobIndex}] Triggered! Queue URL: ${queueUrl} (took ${Date.now() - startTime}ms)`);

  return { queueUrl, jobIndex, startTime };
}

/**
 * Poll queue until build starts
 */
async function pollQueueForBuild(queueUrl, username, token, jobIndex, maxAttempts = 60) {
  console.log(`[Job ${jobIndex}] Polling queue for build number...`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(queueUrl, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
      },
    });

    if (!response.ok) {
      throw new Error(`[Job ${jobIndex}] Queue poll failed: HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.executable) {
      console.log(`[Job ${jobIndex}] Build started: #${data.executable.number}`);
      return {
        buildNumber: data.executable.number,
        buildUrl: data.executable.url,
      };
    }

    if (data.cancelled) {
      throw new Error(`[Job ${jobIndex}] Build was cancelled`);
    }

    // Check why it's waiting
    if (data.why) {
      console.log(`[Job ${jobIndex}] Waiting: ${data.why}`);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(`[Job ${jobIndex}] Timeout waiting for build to start`);
}

/**
 * Get build status
 */
async function getBuildStatus(baseUrl, job, buildNumber, username, token) {
  const url = `${baseUrl}/job/${job}/${buildNumber}/api/json?tree=building,result`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get build status: HTTP ${response.status}`);
  }

  const data = await response.json();
  return {
    building: data.building,
    result: data.result,
  };
}

/**
 * Monitor multiple builds running in parallel
 */
async function monitorBuilds(baseUrl, job, builds, username, token) {
  console.log("\n========================================");
  console.log("MONITORING PARALLEL BUILDS");
  console.log("========================================\n");

  const results = [];
  const maxPolls = 120; // 2 minutes max per build

  for (const build of builds) {
    results.push({
      jobIndex: build.jobIndex,
      buildNumber: build.buildNumber,
      status: "RUNNING",
      result: null,
    });
  }

  // Poll all builds until they complete
  for (let poll = 0; poll < maxPolls; poll++) {
    let allComplete = true;

    for (const result of results) {
      if (result.status === "RUNNING") {
        try {
          const status = await getBuildStatus(baseUrl, job, result.buildNumber, username, token);
          if (!status.building) {
            result.status = "COMPLETE";
            result.result = status.result;
            console.log(`[Job ${result.jobIndex}] Build #${result.buildNumber} completed: ${status.result}`);
          } else {
            allComplete = false;
          }
        } catch (e) {
          console.log(`[Job ${result.jobIndex}] Error checking status: ${e.message}`);
          allComplete = false;
        }
      }
    }

    if (allComplete) {
      break;
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return results;
}

/**
 * Main PoC function - trigger multiple parallel jobs
 */
async function runParallelJobsPoc() {
  console.log("========================================");
  console.log("JENKINS PARALLEL JOB PoC");
  console.log("========================================\n");

  if (!JENKINS_USERNAME || !JENKINS_TOKEN) {
    console.error("ERROR: JENKINS_USERNAME and JENKINS_TOKEN must be set in .dev.vars");
    process.exit(1);
  }

  console.log("Configuration:");
  console.log(`  Jenkins URL: ${JENKINS_BASE_URL}`);
  console.log(`  Job Name: ${JOB_NAME}`);
  console.log(`  Username: ${JENKINS_USERNAME}`);
  console.log(`  Token: ${JENKINS_TOKEN.substring(0, 4)}...${JENKINS_TOKEN.slice(-4)}`);
  console.log();

  // Step 1: Verify connection and get environment choices
  console.log("Step 1: Verifying Jenkins connection...");
  let envChoices;
  try {
    envChoices = await getEnvChoices(JENKINS_BASE_URL, JOB_NAME, JENKINS_USERNAME, JENKINS_TOKEN);
    console.log(`Available environments: ${envChoices.join(", ")}`);
  } catch (e) {
    console.error(`Failed to connect to Jenkins: ${e.message}`);
    console.log("\nMake sure to update JENKINS_BASE_URL in this script!");
    process.exit(1);
  }

  if (envChoices.length === 0) {
    console.error("No environment choices found. Check job configuration.");
    process.exit(1);
  }

  // Use first available environment for testing
  const testEnv = envChoices[0];
  console.log(`Using environment: ${testEnv}`);
  console.log();

  // Step 2: Trigger multiple jobs
  const PARALLEL_COUNT = 3;
  const SEQUENTIAL_MODE = process.argv.includes("--sequential");
  
  console.log(`Step 2: Triggering ${PARALLEL_COUNT} jobs (${SEQUENTIAL_MODE ? "SEQUENTIAL" : "PARALLEL"} mode)...`);
  console.log("(Each job will have a slightly different SQL to ensure uniqueness)\n");

  const sqlQueries = [
    "SELECT COUNT(*) FROM config.app_config;",
    "SELECT COUNT(*) FROM config.app_config;",
    "SELECT COUNT(*) FROM config.app_config;",
  ];

  const triggerStartTime = Date.now();
  let triggerPromises;

  if (SEQUENTIAL_MODE) {
    // Sequential mode: wait for each job to START before triggering next
    // This simulates UI behavior where you wait between clicks
    const results = [];
    for (let i = 0; i < PARALLEL_COUNT; i++) {
      const sql = sqlQueries[i];
      const result = await triggerJob(JENKINS_BASE_URL, JOB_NAME, testEnv, sql, JENKINS_USERNAME, JENKINS_TOKEN, i + 1);
      results.push(result);

      if (i < PARALLEL_COUNT - 1) {
        console.log(`\n[Sequential] Waiting for job ${i + 1} to leave queue before triggering next...`);
        const build = await pollQueueForBuild(result.queueUrl, JENKINS_USERNAME, JENKINS_TOKEN, i + 1);
        console.log(`[Sequential] Job ${i + 1} started as build #${build.buildNumber}\n`);
      }
    }
    triggerPromises = results.map((r) => Promise.resolve(r));
  } else {
    // Parallel mode: trigger all at once
    triggerPromises = sqlQueries
      .slice(0, PARALLEL_COUNT)
      .map((sql, index) => triggerJob(JENKINS_BASE_URL, JOB_NAME, testEnv, sql, JENKINS_USERNAME, JENKINS_TOKEN, index + 1));
  }

  let triggered;
  try {
    triggered = await Promise.all(triggerPromises);
    console.log(`\nAll ${PARALLEL_COUNT} jobs triggered in ${Date.now() - triggerStartTime}ms`);
  } catch (e) {
    console.error(`\nFailed to trigger parallel jobs: ${e.message}`);
    console.log("\nThis might indicate:");
    console.log("  1. Invalid credentials");
    console.log('  2. Job does not have "Execute concurrent builds if necessary" enabled');
    console.log("  3. Not enough executors available");
    process.exit(1);
  }

  // Step 3: Poll for build numbers
  console.log("\nStep 3: Waiting for builds to start...\n");

  const pollPromises = triggered.map((t) =>
    pollQueueForBuild(t.queueUrl, JENKINS_USERNAME, JENKINS_TOKEN, t.jobIndex).then((build) => ({ ...build, jobIndex: t.jobIndex })),
  );

  let builds;
  try {
    builds = await Promise.all(pollPromises);
  } catch (e) {
    console.error(`\nFailed while polling for builds: ${e.message}`);
    process.exit(1);
  }

  // Step 4: Check if builds are actually running in parallel
  console.log("\n========================================");
  console.log("PARALLEL EXECUTION ANALYSIS");
  console.log("========================================\n");

  const buildNumbers = builds.map((b) => b.buildNumber);
  console.log(`Build numbers: ${buildNumbers.join(", ")}`);

  // Check if builds are consecutive (indicates they were queued, not parallel)
  const isConsecutive = buildNumbers.every((n, i) => i === 0 || n === buildNumbers[i - 1] + 1);

  if (isConsecutive && buildNumbers.length > 1) {
    console.log("\n⚠️  Build numbers are consecutive.");
    console.log("This MIGHT indicate sequential execution, but not necessarily.");
    console.log("Let's check if they're running simultaneously...\n");
  }

  // Check current status of all builds
  console.log("Checking build statuses...\n");
  let runningCount = 0;

  for (const build of builds) {
    try {
      const status = await getBuildStatus(JENKINS_BASE_URL, JOB_NAME, build.buildNumber, JENKINS_USERNAME, JENKINS_TOKEN);
      const statusStr = status.building ? "RUNNING" : `COMPLETE (${status.result})`;
      console.log(`  Build #${build.buildNumber}: ${statusStr}`);
      if (status.building) runningCount++;
    } catch (e) {
      console.log(`  Build #${build.buildNumber}: Error - ${e.message}`);
    }
  }

  console.log();
  if (runningCount > 1) {
    console.log("✅ PARALLEL EXECUTION CONFIRMED!");
    console.log(`   ${runningCount} builds are running simultaneously.`);
    console.log("\nThis proves Jenkins allows parallel execution of the same job type.");
  } else if (runningCount === 1) {
    console.log("⚠️  Only 1 build currently running.");
    console.log("   Other builds may have completed quickly or are queued.");
    console.log('   Check Jenkins job config for "Execute concurrent builds if necessary"');
  } else {
    console.log("All builds completed.");
    console.log("The jobs may have executed too quickly to verify parallel execution.");
  }

  // Step 5: Wait for all to complete and show final summary
  console.log("\nStep 5: Waiting for all builds to complete...\n");
  const finalResults = await monitorBuilds(JENKINS_BASE_URL, JOB_NAME, builds, JENKINS_USERNAME, JENKINS_TOKEN);

  console.log("\n========================================");
  console.log("FINAL SUMMARY");
  console.log("========================================\n");

  for (const result of finalResults) {
    console.log(`Job ${result.jobIndex}: Build #${result.buildNumber} - ${result.result || "UNKNOWN"}`);
  }

  const successCount = finalResults.filter((r) => r.result === "SUCCESS").length;
  const failCount = finalResults.filter((r) => r.result === "FAILURE").length;

  console.log(`\nResults: ${successCount} SUCCESS, ${failCount} FAILURE, ${finalResults.length - successCount - failCount} OTHER`);
}

// Run the PoC
runParallelJobsPoc().catch((e) => {
  console.error("\nUnexpected error:", e);
  process.exit(1);
});
