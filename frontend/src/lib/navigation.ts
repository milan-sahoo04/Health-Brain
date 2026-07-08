// frontend/src/lib/navigation.ts
export type MenuStatus = "ready" | "partial" | "blocked";

export interface MenuNode {
  id: string;
  label: string;
  status: MenuStatus;
  note?: string; // shown on blocked/partial items, explains why
  children?: MenuNode[];
}

export const menuTree: MenuNode = {
  id: "menu",
  label: "Menu",
  status: "ready",
  children: [
    {
      id: "my-profile",
      label: "My Profile",
      status: "partial",
      children: [
        { id: "basic-profile", label: "Basic Profile", status: "blocked", note: "Needs patient name/age/sex fields in schema" },
        {
          id: "health-profile",
          label: "Health Profile",
          status: "partial",
          note: "Basic summary only until Health Wiki (Step 4) exists",
          children: [
            { id: "medical-conditions", label: "Medical Conditions", status: "ready" },
            { id: "prescriptions", label: "Prescriptions", status: "ready" },
          ],
        },
        {
          id: "plan-management",
          label: "Plan Management",
          status: "blocked",
          note: "Not defined yet \u2014 needs a spec",
          children: [
            { id: "emergency-contacts", label: "Emergency Contacts", status: "blocked", note: "No schema for this yet" },
          ],
        },
      ],
    },
    {
      id: "settings",
      label: "Settings",
      status: "partial",
      children: [
        { id: "permissions", label: "Permissions", status: "blocked" },
        { id: "language", label: "Language Selection", status: "blocked" },
        { id: "account-deletion", label: "Account Deletion", status: "ready", note: "Backend already supports this" },
      ],
    },
    { id: "ai-assistance", label: "AI Assistance", status: "blocked", note: "Waiting on Reasoning Engine (Step 5)" },
    { id: "dietician-talk", label: "Dietician Talk", status: "blocked", note: "Feature undefined \u2014 needs a decision" },
    { id: "logout", label: "Logout", status: "blocked", note: "No authentication system exists yet" },
  ],
};