'use client';

import { useState, useRef } from 'react';
import { UploadCloud, Play, Square, CheckCircle2, AlertCircle, Clock, Loader2, RotateCcw, Download } from 'lucide-react';
import { processContributor } from '../api';
import * as XLSX from 'xlsx';

export default function PipelineDashboard() {
  const [records, setRecords] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  
  // Ref para que el loop async pueda leer si se presionó detener
  const runningRef = useRef(false);

  // Contadores derivados
  const completed = records.filter(r => r.status === 'COMPLETED').length;
  const errors = records.filter(r => r.status === 'ERROR').length;
  const pending = records.filter(r => r.status === 'PENDING').length;

  const handleFileUpload = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : Object.values(parsed.first || parsed);
        
        const initializedData = arr.map((item: any, idx: number) => ({
          _uuid: idx,
          rut: item.ContribuyenteID?.split('-')[0]?.replace(/\./g, '') || '',
          dv: item.ContribuyenteID?.split('-')[1] || '',
          rznSoc: item.RazonSocial || '',
          rtc: item.RUT || '',
          pass: item.Password || '',
          periodo: parseInt(item.Periodo) || 0,
          status: 'PENDING',
          totalAceptados: 0,
          logs: 'En cola...'
        }));
        setRecords(initializedData);
        setCurrentIdx(-1);
      } catch {
        alert("Error procesando el JSON. Formato inválido.");
      }
    };
    reader.readAsText(file);
  };

  const startProcessing = async () => {
    setIsProcessing(true);
    runningRef.current = true;

    for (let i = 0; i < records.length; i++) {
      // Verificar cancelación
      if (!runningRef.current) {
        // Marcar los que quedaron como detenidos
        setRecords(prev => prev.map((r, idx) => 
          idx >= i && r.status === 'PENDING' 
            ? { ...r, logs: '⏸️ Detenido por el usuario' } 
            : r
        ));
        break;
      }

      // Saltar los que ya no están PENDING
      if (records[i]?.status !== 'PENDING') continue;

      // Marcar como PROCESSING
      setCurrentIdx(i);
      setRecords(prev => {
        const newArr = [...prev];
        newArr[i] = { ...newArr[i], status: 'PROCESSING', logs: '🔐 Autenticando en SII...' };
        return newArr;
      });

      // Llamada real a la API (uno por uno, secuencial)
      const rec = records[i];
      const result = await processContributor(
        rec.rut, rec.dv, rec.rtc, rec.pass, rec.periodo
      );

      // Actualizar con el resultado
      setRecords(prev => {
        const newArr = [...prev];
        newArr[i] = { 
          ...newArr[i], 
          status: result.success ? 'COMPLETED' : 'ERROR', 
          totalAceptados: result.totalDocs || 0,
          logs: result.logs 
        };
        return newArr;
      });

      // Pausa de 3s entre contribuyentes para respetar rate limits del SII
      await new Promise(res => setTimeout(res, 3000));
    }

    setIsProcessing(false);
    setCurrentIdx(-1);
    runningRef.current = false;
  };

  const stopProcessing = () => {
    runningRef.current = false;
    setIsProcessing(false);
    setCurrentIdx(-1);
  };

  const downloadResults = () => {
    // Preparar datos para Excel
    const dataForExcel = records.map((r, idx) => ({
      '#': idx + 1,
      'RUT': `${r.rut}-${r.dv}`,
      'Razón Social': r.rznSoc,
      'Período': r.periodo,
      'Estado': r.status === 'COMPLETED' ? 'Aceptado' : r.status === 'ERROR' ? 'Error' : 'Pendiente',
      'Documentos Aceptados': r.totalAceptados,
      'Logs/Detalles': r.logs
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataForExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Resultados DTE");

    // Ajustar anchos de columna
    const wscols = [
      { wch: 5 },  // #
      { wch: 15 }, // RUT
      { wch: 40 }, // Razón Social
      { wch: 10 }, // Período
      { wch: 15 }, // Estado
      { wch: 20 }, // Documentos Aceptados
      { wch: 60 }, // Logs
    ];
    worksheet['!cols'] = wscols;

    const fileName = `Reporte_DTE_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const resetAll = () => {
    setRecords([]);
    setCurrentIdx(-1);
    setIsProcessing(false);
    runningRef.current = false;
  };
  
  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'PROCESSING': return <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />;
      case 'COMPLETED': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'ERROR': return <AlertCircle className="w-5 h-5 text-red-500" />;
      default: return <Clock className="w-5 h-5 text-slate-400" />;
    }
  };

  const getRowBg = (status: string, idx: number) => {
    if (idx === currentIdx) return 'bg-indigo-50/70 border-l-4 border-l-indigo-500';
    if (status === 'COMPLETED') return 'bg-emerald-50/30';
    if (status === 'ERROR') return 'bg-red-50/30';
    return '';
  };

  return (
    <div className="space-y-6">
      {/* Barra de Control */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Pipeline DTEs</h2>
            <br />
            <p className="text-sm font-bold text-slate-800">
              {records.length} registros 
              {records.length > 0 && (
                <span>
                  {' — '}
                  <span className="text-emerald-600 font-bold">{completed} ✓</span>
                  {' · '}
                  <span className="text-red-500 font-bold">{errors} ✗</span>
                  {' · '}
                  <span className="text-slate-400 font-bold">{pending} pendientes</span>
                </span>
              )}
            </p>
          </div>
          
          <div className="flex gap-3">
            {records.length > 0 && !isProcessing && (
              <>
                <button
                  onClick={downloadResults}
                  className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm active:scale-95"
                >
                  <Download className="w-4 h-4" />
                  Descargar Excel
                </button>
                <button
                  onClick={resetAll}
                  className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl font-medium transition-all active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reiniciar
                </button>
              </>
            )}

            {!isProcessing ? (
              <button
                onClick={startProcessing}
                disabled={records.length === 0 || pending === 0}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-semibold shadow-sm transition-all"
              >
                <Play className="w-4 h-4" />
                Iniciar Proceso
              </button>
            ) : (
              <button
                onClick={stopProcessing}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-xl font-semibold shadow-sm transition-all animate-pulse"
              >
                <Square className="w-4 h-4" />
                Detener Operación
              </button>
            )}
          </div>
        </div>

        {/* Barra de progreso */}
        {records.length > 0 && (
          <div className="mt-4">
            <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div 
                className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-500"
                style={{ width: `${((completed + errors) / records.length) * 100}%` }}
              />
            </div>
            <p className="text-xs text-slate-600 mt-1 text-right">
              {completed + errors} / {records.length} procesados
            </p>
          </div>
        )}
      </div>

      {/* Zona de Drag & Drop */}
      {records.length === 0 && (
        <div 
          className={`border-2 border-dashed rounded-2xl p-10 text-center transition-colors ${dragActive ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-300 hover:border-indigo-400 bg-slate-50'}`}
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); handleFileUpload(e.dataTransfer.files[0]); }}
        >
          <UploadCloud className={`w-12 h-12 mx-auto mb-4 ${dragActive ? 'text-indigo-600' : 'text-slate-400'}`} />
          <p className="text-lg font-semibold text-slate-700">Arrastra tu ArchivoBase_*.json aquí</p>
          <p className="text-slate-500 text-sm mt-2">Los datos se procesarán uno a uno, secuencialmente.</p>
          <input type="file" accept=".json" className="hidden" id="file-internal" onChange={e => handleFileUpload(e.target.files?.[0] as File)} />
          <label htmlFor="file-internal" className="mt-4 inline-block px-4 py-2 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg cursor-pointer hover:bg-slate-50">
            Explorar archivo
          </label>
        </div>
      )}

      {/* Tabla Live */}
      {records.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-sm font-semibold text-slate-600 w-16">#</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 w-16">Estado</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Rut Empresa</th>
                  <th className="p-4 text-sm font-semibold text-slate-600">Razón Social</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 w-24">Aceptados</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 w-24">Período</th>
                  <th className="p-4 text-sm font-semibold text-slate-600 w-2/5">Log</th>
                </tr>
              </thead>
              <tbody>
                {records.map((c, idx) => (
                  <tr 
                    key={c._uuid} 
                    className={`border-b border-slate-100 transition-colors ${getRowBg(c.status, idx)}`}
                  >
                    <td className="p-4 text-xs text-slate-400 font-mono">{idx + 1}</td>
                    <td className="p-4">{getStatusIcon(c.status)}</td>
                    <td className="p-4 font-mono text-sm text-slate-700">{c.rut}-{c.dv}</td>
                    <td className="p-4 font-medium text-slate-800 text-sm">{c.rznSoc}</td>
                    <td className="p-4 font-bold text-emerald-600 text-center">{c.totalAceptados || 0}</td>
                    <td className="p-4 text-sm text-slate-600">{c.periodo}</td>
                    <td className="p-4 text-xs font-mono text-slate-500 whitespace-pre-wrap">{c.logs || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
