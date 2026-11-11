// Renders app/templates/index.html with just the Jinja2 constructs it uses:
// {{ var }}, {% for x in list %}, {% if a %} and {% if a == 'b' %}, nested or not.
// Autoescape matches Jinja2Templates for .html files.
//
// The template is tokenised once and values are only ever inserted into the output,
// never re-scanned, so a query value containing "{{" or "{%" is just text. Any tag the
// renderer does not know throws, so a template change that needs more than this is
// caught by the tests instead of leaking through.
type Ctx = Record<string, unknown>;

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&#34;").replace(/'/g, "&#39;");

function operand(token: string, ctx: Ctx): unknown {
  const lit = token.match(/^(['"])(.*)\1$/);
  return lit ? lit[2] : ctx[token];
}

function condition(expr: string, ctx: Ctx): boolean {
  const eq = expr.match(/^(\S+)\s*==\s*(\S+)$/);
  if (eq) return operand(eq[1], ctx) === operand(eq[2], ctx);
  if (/^\w+$/.test(expr)) return Boolean(ctx[expr]);
  throw new Error(`unsupported template condition: ${expr}`);
}

const tagOf = (token: string): string | null => token.match(/^{%\s*([\s\S]*?)\s*%}$/)?.[1] ?? null;

/** Index of the endfor/endif that closes the block opened at tokens[start]. */
function closingTag(tokens: string[], start: number): number {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    const tag = tagOf(tokens[i]);
    if (tag === null) continue;
    if (/^(for|if)\b/.test(tag)) depth++;
    else if (/^end(for|if)$/.test(tag) && --depth === 0) return i;
  }
  throw new Error("unclosed template block");
}

function run(tokens: string[], ctx: Ctx): string {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const tag = tagOf(token);
    if (tag !== null) {
      const loop = tag.match(/^for (\w+) in (\w+)$/);
      const cond = tag.match(/^if (.+)$/);
      if (!loop && !cond) throw new Error(`unsupported template tag: ${tag}`);
      const end = closingTag(tokens, i);
      const body = tokens.slice(i + 1, end);
      if (loop) {
        for (const item of (ctx[loop[2]] as unknown[]) ?? []) out += run(body, { ...ctx, [loop[1]]: item });
      } else if (condition(cond![1], ctx)) {
        out += run(body, ctx);
      }
      i = end;
      continue;
    }
    const v = token.match(/^{{\s*(\w+)\s*}}$/);
    if (v) {
      out += escapeHtml(String(ctx[v[1]] ?? ""));
    } else if (/{{|{%/.test(token)) {
      throw new Error("template has unsupported syntax");
    } else {
      out += token;
    }
  }
  return out;
}

export function renderTemplate(tpl: string, ctx: Ctx): string {
  return run(tpl.split(/({%[\s\S]*?%}|{{[\s\S]*?}})/), ctx);
}
