// Non-gating performance probe for today.get aggregation.
// Run with: npm run perf -w @emos/service
// This script builds the workspace, then measures buildToday over synthetic data.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildToday } from "@emos/core";
import {
  createCommitmentsRepo,
  createMeetingsRepo,
  createPeopleRepo,
  dataLayout,
  openDb,
} from "@emos/store-sqlite";

const timeZone = "UTC";
const date = "2026-10-25";
const now = new Date(`${date}T07:00:00.000Z`);

function percentile(sorted, p) {
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

function main() {
  const dir = mkdtempSync(join(tmpdir(), "emos-today-perf-"));
  let db;
  try {
    db = openDb(dataLayout(dir).dbFile);
    let counter = 0;
    const idGen = (prefix) => `${prefix}_perf_${++counter}`;
    const clock = { now: () => now };

    const peopleRepo = createPeopleRepo(db, { now: clock.now, id: idGen });
    const self = peopleRepo.create({
      displayName: "Self",
      relationship: "self",
      pronouns: null,
      aliases: [],
      role: "Engineer",
      timeZone: null,
      archived: false,
      oneOnOneCadenceDays: null,
    });
    const people = [self.id];
    const names = [
      "Alex Rivera",
      "Sam Chen",
      "Jordan Patel",
      "Priya Nair",
      "Zoë Quinn",
      "Morgan Lee",
      "Casey Brooks",
      "Taylor Reed",
      "Jamie Fox",
      "Riley Santos",
      "Quinn Murphy",
      "Avery Kim",
      "Skyler Nguyen",
      "Dakota Chen",
      "Reese Thompson",
      "Rowan Evans",
      "Sage Walker",
      "Peyton Harris",
      "Kendall White",
      "Drew Martin",
      "Hayden Clark",
      "Emerson Lewis",
      "Tatum Robinson",
      "Finley Young",
      "Lennon King",
      "Sawyer Wright",
      "Spencer Scott",
      "Micah Green",
      "River Adams",
    ];
    for (let i = 0; i < 29; i += 1) {
      const p = peopleRepo.create({
        displayName: names[i] ?? `Person ${i}`,
        relationship: "peer",
        pronouns: null,
        aliases: [],
        role: "Engineer",
        timeZone: null,
        archived: false,
        oneOnOneCadenceDays: null,
      });
      people.push(p.id);
    }

    const commitmentsRepo = createCommitmentsRepo(db, { now: clock.now, id: idGen });
    const commitments = [];
    for (let i = 0; i < 500; i += 1) {
      const due = i % 5 === 0 ? { date, time: null, timeZone } : null;
      const c = commitmentsRepo.create({
        title: `perf_${i}`,
        direction: i % 7 === 0 ? "owed_to_me" : "mine",
        status: "active",
        dropReason: null,
        urgency: null,
        priority: i % 4,
        due,
        tags: [],
        createdBy: "user",
        ownerId: self.id,
        counterpartId: null,
        goalId: null,
        meetingId: null,
        notes: "",
        pinned: false,
        pinProvenance: null,
        ticketId: null,
        effortMinutes: 15 + (i % 8) * 15,
        snoozedUntil: null,
        completedAt: null,
        recurrence: null,
        seriesId: null,
        confidence: null,
      });
      commitments.push(c);
    }

    const meetingsRepo = createMeetingsRepo(db, { now: clock.now, id: idGen });
    const meetings = [];
    for (let i = 0; i < 200; i += 1) {
      const startHour = 9 + (i % 7);
      const start = `2026-10-25T${String(startHour).padStart(2, "0")}:00:00.000Z`;
      const end = `2026-10-25T${String(startHour + 1).padStart(2, "0")}:00:00.000Z`;
      const m = meetingsRepo.upsertExternal({
        connectorId: "cal",
        externalId: `ext_${i}`,
        title: `Perf meeting ${i}`,
        start,
        end,
        allDay: false,
        status: "confirmed",
        selfResponse: "accepted",
        classification: i % 5 === 0 ? "one_on_one" : "other",
        classificationSource: "auto",
        personId: null,
        attendees: [],
        actionItems: [],
        url: null,
      });
      meetings.push(m.meeting);
    }

    db.close();
    db = undefined;

    const profile = {
      workingHours: { start: "09:00", end: "17:00" },
      workWeek: [1, 2, 3, 4, 5],
      rank: {
        topN: 5,
        goalSlots: 1,
        timeCriticalHours: 24,
        staleDays: 14,
        confidenceThreshold: 0.7,
        ticketDueSoonDays: 3,
        weights: {
          timeCritical: 1000,
          overduePerDay: 50,
          hardDated: 400,
          waitingPerDay: 30,
          goal: 150,
          pin: 300,
          priority: [120, 80, 40, 0],
          urgencyNow: 100,
          staleSource: 60,
          lowConfidence: 40,
        },
      },
      minFocusMinutes: 15,
      defaultEffortMinutes: 30,
    };

    const times = [];
    const warmup = 5;
    const runs = 50;
    for (let i = 0; i < warmup + runs; i += 1) {
      const start = performance.now();
      buildToday({
        localDate: date,
        timeZone,
        now,
        onboarded: true,
        profile,
        commitments,
        meetings,
        goals: [],
        sourceItems: [],
        syncStates: [],
        dayPlanIds: null,
        refresh: false,
      });
      const end = performance.now();
      if (i >= warmup) times.push(end - start);
    }

    times.sort((a, b) => a - b);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const budget = 500;
    const status = p95 <= budget ? "PASS" : "FAIL (over budget)";
    // eslint-disable-next-line no-console
    console.log(
      `today.get aggregation: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms runs=${runs} budget=${budget}ms ${status}`,
    );
  } finally {
    if (db) db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
