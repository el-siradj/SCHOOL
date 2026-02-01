function applyVars(text, vars) {
  return String(text || "").replace(/\{(\w+)\}/g, (_, k) => (vars?.[k] ?? `{${k}}`));
}
module.exports = { applyVars };
