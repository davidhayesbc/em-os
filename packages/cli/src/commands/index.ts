import type { Command } from "../command.js";
import { backupCommand } from "./backup.js";
import { doctorCommand } from "./doctor.js";
import { serviceCommand } from "./service.js";

// Append-only registry. Later phases add commands (and doctor lines) here.
export const commands: Command[] = [doctorCommand, backupCommand, serviceCommand];
