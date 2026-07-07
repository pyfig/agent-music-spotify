// Bun bundles `.md` imports with `with { type: "text" }` as plain strings.
declare module "*.md" {
  const text: string;
  export default text;
}
