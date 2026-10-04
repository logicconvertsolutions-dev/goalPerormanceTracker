import Link from 'next/link';
import { ChevronRight, ListChecks } from 'lucide-react';
import { AddTaskForm, TaskList, type TodoItem } from './task-list';

export type { TodoItem };

/** How many open tasks the card lists (P31): 5 on a phone, 10 from lg up. */
export const TODO_CARD_MOBILE = 5;
export const TODO_CARD_DESKTOP = 10;

/** My Day To Do (P30): open tasks only -- overdue, then today, then upcoming
 * -- with quick add. Ticked tasks leave the card; "View all" opens the full
 * list with completed ones (/today/tasks). */
export function TodoCard({
  tasks,
  openCount,
  today,
  timeZone,
}: {
  tasks: TodoItem[];
  openCount: number;
  today: string;
  timeZone: string | null;
}) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4 shadow-card" aria-labelledby="todo-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="todo-heading" className="flex items-center gap-2 text-[17px] font-bold text-fg">
          <ListChecks className="h-[18px] w-[18px]" aria-hidden="true" />
          To Do
          <span className="text-xs font-semibold text-fg-3">{openCount} open</span>
        </h2>
        <Link href="/today/tasks" className="flex items-center gap-0.5 text-sm font-bold text-acc hover:underline">
          View all
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <AddTaskForm today={today} />

      {tasks.length === 0 ? (
        <p className="mt-3 text-sm text-fg-3">Nothing open. Add a task above — it will show on your calendar too.</p>
      ) : (
        <div className="mt-1">
          <TaskList tasks={tasks} today={today} timeZone={timeZone} hideDone mobileLimit={TODO_CARD_MOBILE} />
          {openCount > TODO_CARD_MOBILE && (
            <Link
              href="/today/tasks"
              className="mt-1 block pt-2 text-center text-xs font-bold text-acc hover:underline lg:hidden"
            >
              +{openCount - TODO_CARD_MOBILE} more open
            </Link>
          )}
          {openCount > TODO_CARD_DESKTOP && (
            <Link
              href="/today/tasks"
              className="mt-1 hidden pt-2 text-center text-xs font-bold text-acc hover:underline lg:block"
            >
              +{openCount - TODO_CARD_DESKTOP} more open
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
