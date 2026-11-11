declare module "*.ttf" { const data: ArrayBuffer; export default data; }
declare module "*.png" { const data: ArrayBuffer; export default data; }
declare module "*.wasm" { const mod: WebAssembly.Module; export default mod; }
declare module "*.html" { const text: string; export default text; }
