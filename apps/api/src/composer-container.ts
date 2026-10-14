import { Container } from "@cloudflare/containers";

/** apps/composer (spec §3): scoring and ffmpeg compose; stateless, sleeps when idle. */
export class Composer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}
