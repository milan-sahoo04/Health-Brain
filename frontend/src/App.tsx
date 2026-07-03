import { useState } from "react";
import { PatientSidebar } from "./components/patient/PatientSidebar";
import { EventForm } from "./components/events/EventForm";
import { EventList } from "./components/events/EventList";
import { PatientGraph } from "./components/patient/PatientGraph";
import { BulkImport } from "./components/events/BulkImport";
import { ImportHistory } from "./components/events/ImportHistory";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-serif text-lg text-[#1B2430] mb-3 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#3F7D58] inline-block" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function App() {
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(
    "patient-1",
  );
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-screen bg-[#F5F5F1]">
      <PatientSidebar
        selectedPatientId={selectedPatientId}
        onSelect={(id) => setSelectedPatientId(id || null)}
        refreshSignal={refreshKey}
      />

      <main className="flex-1 overflow-y-auto">
        {!selectedPatientId ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-[#8A8577]">
              Select or add a patient to get started.
            </p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-10 py-10 space-y-10">
            <div className="border-b border-[#E4E1D8] pb-4">
              <p className="text-[11px] uppercase tracking-widest text-[#8A8577]">
                Patient Record
              </p>
              <h1 className="font-serif text-3xl text-[#1B2430] font-mono">
                {selectedPatientId}
              </h1>
            </div>

            <Section title="Log New Event">
              <EventForm
                patientId={selectedPatientId}
                onSaved={() => setRefreshKey((k) => k + 1)}
              />
            </Section>

            <Section title="Bulk Import">
              <BulkImport onImported={() => setRefreshKey((k) => k + 1)} />
            </Section>

            <Section title="Import History">
              <ImportHistory
                refreshSignal={refreshKey}
                onBatchDeleted={() => setRefreshKey((k) => k + 1)}
              />
            </Section>

            <Section title="Events">
              <EventList key={refreshKey} patientId={selectedPatientId} />
            </Section>

            <Section title="Patient Graph">
              <PatientGraph key={refreshKey} patientId={selectedPatientId} />
            </Section>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
