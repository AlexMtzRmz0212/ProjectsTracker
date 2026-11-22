import Modal from "./Modal";
import { N_, __, useT } from "../i18n";

/** What each kind of thing in the tracker is, grouped by where it lives. Opened from the header's More menu. */
const GROUPS = [
  {
    title: N_("Things to do"),
    items: [
      [N_("Project"), N_("Something you work on over time. It has its own timer, a colour and icon, a status, and a to-do list. The Projects tab shows them as a board.")],
      [N_("Status"), N_("Where a project stands: Idea, Active, On hold, Done… They are the board's columns, and can be edited under Statuses.")],
      [N_("To-do"), N_("One line on a project's to-do list. Ticking it off logs it on that day, under Ticked off in the Calendar.")],
      [N_("Sub-to-do"), N_("A step under a to-do, one level deep. Ticking the to-do off ticks off its open sub-to-dos too.")],
      [N_("Task"), N_("A to-do with no project: a one-off thing, on the Tasks tab. It can be timed like a project, and leaves the list once ticked off.")],
      [N_("Sub-task"), N_("A step under a task. Works like a sub-to-do.")],
    ],
  },
  {
    title: N_("Marks on a to-do or task"),
    items: [
      [N_("Working on"), N_("A mark on what you're in the middle of (the blinking dot). Listed under Working on in the header and on the Workspace tab. It isn't a timer.")],
      [N_("Cancelled"), N_("Closed without being done. It leaves the list but isn't counted as work done.")],
      [N_("Estimate"), N_("A time at the end of the text, like \"(~45m)\". Copy for AI on the Tasks tab asks an AI to add them.")],
    ],
  },
  {
    title: N_("Time"),
    items: [
      [N_("Session"), N_("A block of time on a project or task: from its timer, or added by hand. They are the blocks in the Calendar.")],
      [N_("Open item"), N_("Work started and left open, which can run for days next to the timer. Closing it turns it into a session.")],
      [N_("Pomodoro"), N_("One focus countdown, with breaks between them. It can say what it was for: a project, a task, or a chore.")],
      [N_("Chore"), N_("A few words for a focus that isn't a project or task, like \"laundry\". It's only for that one focus.")],
      [N_("Habit"), N_("Made on the Habits tab (In-app: click a day's square to log it) or picked from the My Habits app's Drive backup (read-only here: edit those in that app).")],
    ],
  },
];

export default function GuideModal({ onClose }) {
  useT();
  return (
    <Modal title={__("Guide")} onClose={onClose}>
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="border-b border-rule pb-1 font-serif text-xs italic text-muted">{__(group.title)}</h3>
            <dl className="mt-2 space-y-2.5">
              {group.items.map(([term, text]) => (
                <div key={term}>
                  <dt className="text-[14px] font-semibold">{__(term)}</dt>
                  <dd className="text-[13px] leading-snug text-muted">{__(text)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
