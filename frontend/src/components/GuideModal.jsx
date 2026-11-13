import Modal from "./Modal";

/** What each kind of thing in the tracker is, grouped by where it lives. Opened from the header's More menu. */
const GROUPS = [
  {
    title: "Things to do",
    items: [
      ["Project", "Something you work on over time. It has its own timer, a colour and icon, a status, and a to-do list. The Projects tab shows them as a board."],
      ["Status", "Where a project stands: Idea, Active, On hold, Done… They are the board's columns, and can be edited under Statuses."],
      ["To-do", "One line on a project's to-do list. Ticking it off logs it on that day, under Ticked off in the Calendar."],
      ["Sub-to-do", "A step under a to-do, one level deep. Ticking the to-do off ticks off its open sub-to-dos too."],
      ["Task", "A to-do with no project: a one-off thing, on the Tasks tab. It can be timed like a project, and leaves the list once ticked off."],
      ["Sub-task", "A step under a task. Works like a sub-to-do."],
    ],
  },
  {
    title: "Marks on a to-do or task",
    items: [
      ["Working on", "A mark on what you're in the middle of (the blinking dot). Listed under Working on in the header and on the Workspace tab. It isn't a timer."],
      ["Cancelled", "Closed without being done. It leaves the list but isn't counted as work done."],
      ["Estimate", 'A time at the end of the text, like "(~45m)". Copy for AI on the Tasks tab asks an AI to add them.'],
    ],
  },
  {
    title: "Time",
    items: [
      ["Session", "A block of time on a project or task: from its timer, or added by hand. They are the blocks in the Calendar."],
      ["Open item", "Work started and left open, which can run for days next to the timer. Closing it turns it into a session."],
      ["Pomodoro", "One focus countdown, with breaks between them. It can say what it was for: a project, a task, or a chore."],
      ["Chore", "A few words for a focus that isn't a project or task, like \"laundry\". It's only for that one focus."],
      ["Habit", "Copied in from the My Habits app's backup, on the Habits tab. Read-only here: edit habits in that app."],
    ],
  },
];

export default function GuideModal({ onClose }) {
  return (
    <Modal title="Guide" onClose={onClose}>
      <div className="space-y-6">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h3 className="border-b border-rule pb-1 font-serif text-xs italic text-muted">{group.title}</h3>
            <dl className="mt-2 space-y-2.5">
              {group.items.map(([term, text]) => (
                <div key={term}>
                  <dt className="text-[14px] font-semibold">{term}</dt>
                  <dd className="text-[13px] leading-snug text-muted">{text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
