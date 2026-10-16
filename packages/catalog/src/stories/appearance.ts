/**
 * What the describe step read from each photo (christmas content spec §2.3): head covering, hair,
 * facial hair, glasses. survivor = photo 1, infected = photo 2. "" = nothing usable.
 * Never stored outside the story's own Durable Object state (spec §7).
 */
export type Appearance = { survivor: string; infected: string };

export const EMPTY_APPEARANCE: Appearance = { survivor: "", infected: "" };
