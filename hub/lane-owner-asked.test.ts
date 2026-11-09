import { expect, test } from "bun:test";
import { ownerAsked } from "./lanerun.ts";

const OPUS = "anthropic/claude-opus-5-5", FABLE = "anthropic/claude-fable-5-1";

test("a Fable model the owner picked for the lane or its workers counts as asked; a cheap one or effort alone does not", () => {
	expect(ownerAsked({ model: OPUS, workerModel: OPUS })).toBe(false);
	expect(ownerAsked({ model: `${OPUS}:xhigh`, workerModel: `${OPUS}:max` })).toBe(false);
	expect(ownerAsked({ model: `${FABLE}:high`, workerModel: OPUS })).toBe(true);
	expect(ownerAsked({ model: OPUS, workerModel: FABLE })).toBe(true);
	expect(ownerAsked({ model: OPUS, workerModel: OPUS, fableOk: true })).toBe(true);
});

test("a Fable worker model the lane recorded itself is not the owner's pick", () => {
	expect(ownerAsked({ model: OPUS, workerModel: FABLE, workerByLane: true })).toBe(false);
});
