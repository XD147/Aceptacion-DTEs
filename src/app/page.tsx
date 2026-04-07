import PipelineDashboard from "@/features/dte-pipeline/components/PipelineDashboard";

export default function Home() {
  return (
    <main className="max-w-6xl mx-auto w-full p-4 md:p-8">
      <header className="mb-10">
        <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-800 to-blue-800 tracking-tight pb-2 text-center">
          Aceptación DTEs
        </h1>
        <p className="text-slate-500 font-medium text-lg text-center">
          Sistema de aceptación de documentos tributarios electrónicos
        </p>
      </header>
      
      <PipelineDashboard />
      
    </main>
  );
}
