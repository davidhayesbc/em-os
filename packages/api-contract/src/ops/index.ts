import { backupCreate } from "./backup.js";
import {
  commitmentsComplete,
  commitmentsCreate,
  commitmentsDrop,
  commitmentsGet,
  commitmentsList,
  commitmentsPin,
  commitmentsReopen,
  commitmentsSnooze,
  commitmentsUpdate,
} from "./commitments.js";
import { goalsCreate, goalsList, goalsUpdate } from "./goals.js";
import { healthGet } from "./health.js";
import {
  peopleAddIdentity,
  peopleCreate,
  peopleGet,
  peopleList,
  peopleResolve,
  peopleUpdate,
  personNotesCreate,
  personNotesList,
} from "./people.js";
import { serviceShutdown } from "./service.js";
import { layoutGet, layoutSet, settingsGet, settingsUpdate } from "./settings.js";

// Append-only registry, keyed by op name. Other tasks add entries.
export const ops = {
  "health.get": healthGet,
  "backup.create": backupCreate,
  "service.shutdown": serviceShutdown,
  "commitments.list": commitmentsList,
  "commitments.get": commitmentsGet,
  "commitments.create": commitmentsCreate,
  "commitments.update": commitmentsUpdate,
  "commitments.complete": commitmentsComplete,
  "commitments.snooze": commitmentsSnooze,
  "commitments.drop": commitmentsDrop,
  "commitments.reopen": commitmentsReopen,
  "commitments.pin": commitmentsPin,
  "goals.list": goalsList,
  "goals.create": goalsCreate,
  "goals.update": goalsUpdate,
  "settings.get": settingsGet,
  "settings.update": settingsUpdate,
  "layout.get": layoutGet,
  "layout.set": layoutSet,
  "people.list": peopleList,
  "people.get": peopleGet,
  "people.create": peopleCreate,
  "people.update": peopleUpdate,
  "people.addIdentity": peopleAddIdentity,
  "people.resolve": peopleResolve,
  "personNotes.create": personNotesCreate,
  "personNotes.list": personNotesList,
} as const;
