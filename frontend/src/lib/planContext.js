import { createContext, useContext } from "react";

/** The Workspace's plan (see usePlan), for the "Add to plan" buttons that sit all over the app. `null` where there is no
 *  plan (outside the tracker): those buttons are then left out. */
export const PlanContext = createContext(null);
export const usePlanContext = () => useContext(PlanContext);
