import handler from "@tanstack/react-start/server-entry";

export { ReadBudget } from "./server/read-budget";

export default { fetch: handler.fetch };
