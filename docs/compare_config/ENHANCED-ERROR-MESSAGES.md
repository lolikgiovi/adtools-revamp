# Enhanced Error Messages for Oracle Connection Testing

## Overview

Added comprehensive, user-friendly error messages to the `test_oracle_connection` Tauri command to help users quickly diagnose and fix connection issues.

## Changes Made

### Files Modified

1. **[src-tauri/src/oracle/commands.rs](../../src-tauri/src/oracle/commands.rs)**
   - Enhanced `test_oracle_connection()` with pre-flight checks
   - Added detailed diagnostic information on failures
   - Better success messages

2. **[src-tauri/src/oracle/connection.rs](../../src-tauri/src/oracle/connection.rs)**
   - Added `extract_oracle_error_code()` helper function
   - Comprehensive Oracle error code handling (15+ error types)
   - Context-aware error messages with actionable solutions

## Error Categories Handled

### 1. Oracle Client / Library Errors

**Error Codes:** `DPI-1047`, `DPI-1000`

**Example Message:**
```
Oracle Instant Client library could not be loaded.

Library path: ~/Documents/adtools_library/oracle_instantclient

Possible causes:
- Oracle Instant Client not installed
- Missing library dependencies
- Architecture mismatch (ARM64 vs x86_64)

Solution: Run the installation script from the Compare Config page.
```

### 2. Network / TNS Errors

**Error Codes:** `ORA-12170`, `ORA-12541`, `ORA-12543`, `ORA-12545`

**Example Message:**
```
Network error: Cannot reach database server.

Host: dbserver.example.com:1521
Service: ORCL

Possible causes:
- Database server is not running
- Firewall blocking connection
- Incorrect host or port
- Network connectivity issues

Please verify:
1. Database server is accessible
2. Host and port are correct
3. Firewall allows connections on port 1521
```

### 3. Service Name Errors

**Error Code:** `ORA-12514`

**Example Message:**
```
Service name not found: 'ORCL'

The TNS listener is running but doesn't recognize this service name.

Possible causes:
- Service name is misspelled
- Database instance not registered with listener
- Case sensitivity issue (try uppercase)

Please verify:
1. Service name spelling
2. Database instance is running
3. Run 'lsnrctl status' on database server
```

**Error Code:** `ORA-12505`

**Example Message:**
```
SID not found: 'ORCL'

If you're using a service name, ensure you specified it correctly.
If you're using a SID, the database instance may not be running.
```

### 4. Authentication Errors

**Error Code:** `ORA-01017`

**Example Message:**
```
Authentication failed for user: SCOTT

Possible causes:
- Incorrect username or password
- Account is locked
- Password has expired
- Case sensitivity (Oracle usernames are usually uppercase)

Please verify your credentials.
```

**Error Code:** `ORA-28000`

**Example Message:**
```
Account locked: SCOTT

The database account has been locked, usually due to too many failed login attempts.

Contact your DBA to unlock the account using:
ALTER USER SCOTT ACCOUNT UNLOCK;
```

### 5. Connection Timeout Errors

**Error Codes:** `ORA-12609`, `ORA-12535`

**Example Message:**
```
Connection timeout.

Host: dbserver.example.com:1521

The database server is not responding within the timeout period.

Possible causes:
- Network latency issues
- Database server is overloaded
- Firewall is dropping packets
```

### 6. Database Overload Errors

**Error Code:** `ORA-12518`

**Example Message:**
```
Database server is too busy.

The TNS listener could not hand off the client connection.
Wait a moment and try again, or contact your DBA.
```

**Error Code:** `ORA-12520`

**Example Message:**
```
No available dedicated server processes.

The database has reached its process limit.
Contact your DBA to increase PROCESSES parameter.
```

### 7. Generic Network Errors

**Contains "timeout":**
```
Connection timeout to dbserver.example.com:1521

The server is not responding. Please check:
1. Network connectivity
2. Firewall settings
3. Database server status
```

**Contains "refused":**
```
Connection refused by dbserver.example.com:1521

Possible causes:
- TNS listener is not running
- Wrong port number
- Firewall blocking connection

Verify the listener is running: lsnrctl status
```

### 8. Pre-Flight Checks (Before Connection Attempt)

#### Client Not Found
```
Oracle Instant Client not found at: ~/Documents/adtools_library/oracle_instantclient

Please install Oracle Instant Client:
1. Run the installation script from the Compare Config page
2. Or visit: https://www.oracle.com/database/technologies/instant-client/downloads.html
```

#### Client Not Loaded
```
Failed to load Oracle Instant Client: [error details]

The library files exist but couldn't be loaded. This may be due to:
- Missing dependencies
- Architecture mismatch (ARM64 vs x86_64)
- Corrupted installation

Try reinstalling Oracle Instant Client.
```

### 9. Success Message

**Enhanced success feedback:**
```
✓ Successfully connected to Production DB
Host: prod-db.example.com:1521
Service: PRODDB
```

### 10. Fallback Error (Unrecognized)

**For any other error:**
```
Connection failed: [original error message]

Connection Details:
- Host: dbserver.example.com:1521
- Service: ORCL
- Connection String: dbserver.example.com:1521/ORCL

If this error persists, please check:
1. Oracle database is running and accessible
2. Network connectivity to the database server
3. Credentials are correct
4. Service name is correct
```

## Implementation Details

### Error Code Extraction

**Function:** `extract_oracle_error_code()`

Parses error messages to extract Oracle error codes:
- `ORA-XXXXX` (5 digits)
- `DPI-XXXX` (4 digits)

```rust
fn extract_oracle_error_code(error_str: &str) -> Option<String> {
    // Searches for "ORA-" or "DPI-" patterns
    // Returns the first match found
}
```

### Pre-Flight Validation Flow

```
User clicks "Test Connection"
    ↓
1. Validate configuration (host, port, service name)
    ↓
2. Validate credentials (username, password not empty)
    ↓
3. Check if Oracle client files exist
    ↓
4. Check if Oracle client is loaded (primed)
    ↓ (auto-prime if needed)
5. Attempt database connection
    ↓
6. Execute test query (SELECT 1 FROM dual)
    ↓
Success or detailed error message
```

### Diagnostic Information Included

For all connection errors, the following is included:
- **Oracle Client Path** - Where the app is looking for libraries
- **Connection String** - The exact connection string used
- **Host & Port** - Server details
- **Service Name** - Database service being accessed
- **Error Code** - Extracted ORA/DPI code
- **Possible Causes** - Why this might happen
- **Solutions** - What to do about it

## Benefits

### For End Users
- ✅ **Clear error messages** - No more cryptic "ORA-12345" codes
- ✅ **Actionable solutions** - Tells them exactly what to do
- ✅ **Self-service troubleshooting** - Can fix issues without contacting support
- ✅ **Better UX** - Reduces frustration and confusion

### For Developers
- ✅ **Easier debugging** - Comprehensive logs with context
- ✅ **Reduced support load** - Users can solve common issues themselves
- ✅ **Better error tracking** - Can identify common failure patterns

### For DBAs
- ✅ **Specific Oracle commands** - Provides exact SQL to fix issues
- ✅ **Network diagnostics** - Clear guidance on checking connectivity
- ✅ **Listener troubleshooting** - Commands to verify listener status

## Testing

### Test Cases Covered

1. **Client Not Installed**
   - Expected: Clear message with installation instructions
   - ✅ Verified

2. **Wrong Credentials**
   - Expected: Authentication error with suggestions
   - Error code: ORA-01017

3. **Service Name Not Found**
   - Expected: Service name error with verification steps
   - Error code: ORA-12514

4. **Server Not Reachable**
   - Expected: Network error with troubleshooting steps
   - Error codes: ORA-12170, ORA-12541, etc.

5. **Successful Connection**
   - Expected: Formatted success message with details
   - ✅ Verified

## Example User Flow

### Before Enhancement

```
User: *tries to connect*
App: "ORA-12514"
User: 🤷 "What does this mean?"
```

### After Enhancement

```
User: *tries to connect*
App: "Service name not found: 'ORCL'

The TNS listener is running but doesn't recognize this service name.

Possible causes:
- Service name is misspelled
- Database instance not registered with listener
- Case sensitivity issue (try uppercase)

Please verify:
1. Service name spelling
2. Database instance is running
3. Run 'lsnrctl status' on database server"

User: "Oh! Let me check the spelling. I'll try 'ORCLPDB' instead."
```

## Future Enhancements

### Potential Improvements

1. **Interactive Troubleshooting**
   - Add "Test Connection" button that runs diagnostics
   - Ping test
   - Port availability check
   - DNS resolution

2. **Common Fixes**
   - "Try with uppercase service name" button
   - "Retry with default port 1521" button
   - "Check network connectivity" diagnostic

3. **Error History**
   - Track failed connection attempts
   - Suggest solutions based on patterns
   - "This usually happens when..."

4. **Link to Documentation**
   - Specific docs for each error type
   - Video tutorials for common issues
   - FAQ section

## Related Documentation

- [ORACLE-DETECTION-FIX.md](./ORACLE-DETECTION-FIX.md) - Oracle client detection improvements
- [README.md](./README.md) - Compare Config feature overview
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues and solutions

## Error Code Reference

| Code | Description | Severity |
|------|-------------|----------|
| DPI-1047 | Cannot locate Oracle Client library | Critical |
| DPI-1000 | Cannot create Oracle Client environment | Critical |
| ORA-01017 | Invalid username/password | Auth |
| ORA-28000 | Account locked | Auth |
| ORA-12170 | TNS: Connect timeout | Network |
| ORA-12541 | TNS: No listener | Network |
| ORA-12543 | TNS: Destination host unreachable | Network |
| ORA-12545 | TNS: Connection refused | Network |
| ORA-12514 | TNS: Listener does not know of service | Config |
| ORA-12505 | TNS: Listener does not know of SID | Config |
| ORA-12518 | TNS: Listener could not hand off | Server |
| ORA-12520 | TNS: No appropriate service handler | Server |
| ORA-12609 | TNS: Attach timeout | Network |
| ORA-12535 | TNS: Operation timed out | Network |

## Compilation

The enhanced error handling compiles successfully:
```bash
$ cargo check
   Checking adtools v0.1.0
   Finished dev profile in 6.62s
```

No additional dependencies required.
