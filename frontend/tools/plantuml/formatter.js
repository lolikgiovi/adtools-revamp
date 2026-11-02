// Indentation-only formatter. Keep literal text and relative whitespace inside text blocks.
// Unknown diagram languages are deliberately left untouched.
export function formatPlantUml(source, indent = "  ") {
  if (/^\s*@start(?!uml(?:\s|$))\w+/im.test(source)) return source;
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const stack = [];
  const output = [];
  const emit = (line, depth = stack.length) => output.push(indent.repeat(depth) + line);
  // Mask strings and inline comments before inspecting structural punctuation.
  const syntax = (line) => line.replace(/"(?:\\.|[^"\\])*"|'[^\n]*$/g, (text) => " ".repeat(text.length));
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      output.push("");
      continue;
    }
    if (/^\/'/.test(line)) {
      output.push(raw);
      if (!line.slice(2).includes("'/")) {
        while (++i < lines.length) {
          output.push(lines[i]);
          if (lines[i].includes("'/")) break;
        }
      }
      continue;
    }
    if (/^@(?:start|end)uml\b/i.test(line)) {
      stack.length = 0;
      emit(line);
      continue;
    }
    if (/^'/.test(line)) {
      emit(line);
      continue;
    }
    const code = syntax(line).trim();
    const textKind = /^(note|hnote|rnote|legend|ref)\b/i.exec(code)?.[1]?.toLowerCase();
    const bareText = /^(title|caption|header|footer)$/i.exec(code)?.[1]?.toLowerCase();
    const kind = textKind || bareText;
    if (kind && !code.includes(":") && !/^note\s+"/i.test(line)) {
      const endKind = /^(?:hnote|rnote)$/.test(kind) ? "(?:note|hnote|rnote)" : kind;
      const end = new RegExp(`^end\\s*${endKind}$`, "i");
      let last = i + 1;
      while (last < lines.length && !end.test(lines[last].trim())) last++;
      if (last === lines.length) {
        output.push(...lines.slice(i));
        break;
      }
      emit(line);
      const body = lines.slice(i + 1, last);
      const widths = body.filter((text) => text.trim()).map((text) => text.match(/^\s*/)[0].length);
      const common = widths.length ? Math.min(...widths) : 0;
      for (const text of body) {
        if (text.trim()) emit(text.slice(common).trimEnd(), stack.length + 1);
        else output.push("");
      }
      emit(lines[last].trim());
      i = last;
      continue;
    }
    if (/^:[^;]*$/.test(line)) {
      emit(line);
      const leading = raw.match(/^\s*/)[0].length;
      while (++i < lines.length) {
        const text = lines[i];
        if (text.trim()) emit(text.slice(Math.min(leading, text.match(/^\s*/)[0].length)).trimEnd());
        else output.push("");
        if (/;\s*$/.test(text)) break;
      }
      continue;
    }
    const structural = code.split(":")[0].trim();
    // A message label, a quoted brace, or a comment cannot open a structural block.
    const message = /(?:<?[-.=]+>|<[-.=]+|[-.=]+>)/.test(structural);
    if (/^(?:endswitch|end\s+switch)\b/i.test(code) && stack.at(-1) === "case") stack.pop();
    if (/^case\b/i.test(code)) {
      if (stack.at(-1) === "case") stack.pop();
      emit(line);
      stack.push("case");
      continue;
    }
    const branch = /^(?:!?else(?:if)?|fork\s+again|split\s+again)\b/i.test(code) && !message;
    const closes = /^(?:end(?:\s|$)|endbox\b|endif\b|endwhile\b|endswitch\b|repeat\s+while\b|!end\w*\b)/i.test(code);
    const leadingClosers = structural.match(/^}+\s*/)?.[0].replace(/\s/g, "").length || 0;
    const closeCount = leadingClosers || (closes || branch ? 1 : 0);
    for (let n = 0; n < closeCount; n++) stack.pop();
    emit(line);
    const opens =
      !message &&
      !closes &&
      !branch &&
      (/^(?:alt|opt|loop|par|break|critical|group|box|partition|fork|split|repeat)\b/i.test(code) ||
        /^(?:if|while|switch)\s*\(/i.test(code) ||
        /^!(?:(?:unquoted\s+)?(?:procedure|function)|if(?:def|ndef)?|while|foreach|definelong|startsub)\b/i.test(code));
    const braces = message ? 0 : (structural.match(/{/g)?.length || 0) - (structural.match(/}/g)?.length || 0) + leadingClosers;
    if (branch || opens || braces > 0) {
      const count = Math.max(1, braces);
      for (let n = 0; n < count; n++) stack.push(/^switch\s*\(/i.test(code) ? "switch" : "block");
    }
  }
  return output.join("\n").replace(/\n*$/, "\n");
}
