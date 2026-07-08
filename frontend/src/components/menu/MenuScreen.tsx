// frontend/src/components/menu/MenuScreen.tsx
import { useState } from "react";
import { menuTree, type MenuNode, type MenuStatus } from "../../lib/navigation";
import { EventTypeList } from "./screens/EventTypeList";
import { AccountDeletion } from "./screens/AccountDeletion";

const STATUS_STYLES: Record<MenuStatus, string> = {
  ready: "bg-teal-50 text-teal-700 border-teal-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  blocked: "bg-slate-100 text-slate-500 border-slate-200",
};

// Screens that have real, working content instead of a placeholder.
// Keyed by MenuNode.id (see lib/navigation.ts).
const screenComponents: Record<
  string,
  React.ComponentType<{ patientId: string }>
> = {
  "medical-conditions": (props) => (
    <EventTypeList
      {...props}
      eventType="Condition"
      emptyHint="No conditions logged yet. Log an event with type 'Condition' to see it here."
    />
  ),
  prescriptions: (props) => (
    <EventTypeList
      {...props}
      eventType="Medication"
      emptyHint="No medications logged yet."
    />
  ),
  "account-deletion": AccountDeletion,
};

interface MenuScreenProps {
  patientId: string;
}

export function MenuScreen({ patientId }: MenuScreenProps) {
  const [stack, setStack] = useState<MenuNode[]>([menuTree]);
  const current = stack[stack.length - 1];
  const CurrentScreen = screenComponents[current.id];

  function drillInto(node: MenuNode) {
    // Drill in if there are child menu items to show, OR if this leaf
    // has a real screen component registered above.
    if (node.children || screenComponents[node.id]) {
      setStack((prev) => [...prev, node]);
    }
  }

  function goBack() {
    setStack((prev) => prev.slice(0, -1));
  }

  return (
    <div className="max-w-md mx-auto border border-slate-200 rounded-lg bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        {stack.length > 1 && (
          <button
            onClick={goBack}
            className="text-slate-500 hover:text-slate-800 text-sm"
          >
            ← Back
          </button>
        )}
        <h2 className="text-sm font-semibold text-slate-700">
          {current.label}
        </h2>
      </div>

      <div className="p-2 space-y-1">
        {current.children?.map((node) => (
          <button
            key={node.id}
            onClick={() => drillInto(node)}
            disabled={
              !node.children &&
              !screenComponents[node.id] &&
              node.status === "blocked"
            }
            className="w-full flex items-center justify-between px-3 py-2 rounded-md hover:bg-slate-50 text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="text-sm text-slate-700">{node.label}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLES[node.status]}`}
            >
              {node.status === "ready"
                ? "Ready"
                : node.status === "partial"
                  ? "Partial"
                  : "Coming Soon"}
            </span>
          </button>
        ))}

        {!current.children &&
          (CurrentScreen ? (
            <CurrentScreen patientId={patientId} />
          ) : (
            <p className="text-sm text-slate-400 px-3 py-4">
              {current.note ?? "Content not implemented yet."}
            </p>
          ))}
      </div>
    </div>
  );
}
