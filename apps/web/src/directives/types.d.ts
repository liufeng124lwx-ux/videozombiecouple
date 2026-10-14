export {};

declare module "astro" {
  interface AstroClientDirectives {
    "client:after-load"?: boolean;
  }
}
