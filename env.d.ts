/// <reference types="vite/client" />

declare module "*.as?raw" {
  const content: string;
  export default content;
}
