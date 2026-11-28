import test from "node:test";
import assert from "node:assert/strict";
import { teacherEmail } from "../lib/teacher-auth.ts";

test("teacher login identifier is deterministic and based on employee number", () => {
  assert.equal(teacherEmail("20180099"), "teacher-20180099@teachers.scores.invalid");
  assert.equal(teacherEmail(" 20180099 "), "teacher-20180099@teachers.scores.invalid");
});
