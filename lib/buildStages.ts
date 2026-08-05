/**
 * The six stages a build_campaign job moves through, in order.
 *
 * Lives here rather than in lib/engine/build.ts because the browser needs it too — the build
 * progress checklist reads jobs.stage against this list. Importing it from build.ts pulled the
 * Anthropic SDK (and its node:path dependency) into a client bundle, which typechecks fine and
 * fails at build time. One list, no server imports, so both sides stay in step.
 */
export const BUILD_CAMPAIGN_STAGES = ["context", "image", "ads", "pages", "content", "social"] as const;

export type BuildStage = (typeof BUILD_CAMPAIGN_STAGES)[number];
