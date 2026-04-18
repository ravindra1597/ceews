import { X, UserMinus } from 'lucide-react';

export default function PatientModals({
  addModal, setAddModal,
  newName, setNewName,
  newId, setNewId,
  idError, setIdError,
  addPatient,
  dischargeModal, setDischargeModal,
  patientMap,
  dischargePatient,
}) {
  const closeAdd = () => { setAddModal(false); setIdError(''); setNewName(''); setNewId(''); };

  return (
    <>
      {/* Add Patient Modal */}
      {addModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-gray-900">Add Patient</h3>
              <button onClick={closeAdd} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-full hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Patient Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addPatient()}
                  placeholder="e.g. Jane D."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:border-[#0a1628] focus:ring-1 focus:ring-[#0a1628] placeholder-gray-300"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Patient ID</label>
                <input
                  type="text"
                  value={newId}
                  onChange={e => { setNewId(e.target.value); setIdError(''); }}
                  onKeyDown={e => e.key === 'Enter' && addPatient()}
                  placeholder="e.g. ER-004"
                  className={`w-full border rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 placeholder-gray-300 ${
                    idError ? 'border-red-300 focus:border-red-400 focus:ring-red-300' : 'border-gray-200 focus:border-[#0a1628] focus:ring-[#0a1628]'
                  }`}
                />
                {idError && <p className="text-xs text-red-500 mt-1">{idError}</p>}
                <p className="text-xs text-gray-400 mt-1">Used as the Firestore collection key. Spaces become underscores.</p>
              </div>
            </div>
            <div className="flex gap-2.5 mt-5">
              <button onClick={closeAdd} className="flex-1 py-2.5 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={addPatient}
                disabled={!newName.trim() || !newId.trim()}
                className="flex-1 py-2.5 text-sm font-bold bg-[#0a1628] text-white rounded-xl hover:bg-[#1a2a48] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Add to Ward
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discharge Confirmation Modal */}
      {dischargeModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <UserMinus className="w-5 h-5 text-[#dc2626]" />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">Discharge Patient</h3>
                <p className="text-xs text-gray-400">This action stops monitoring</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 mb-5 bg-gray-50 rounded-xl p-3 border border-gray-200">
              Remove <strong className="text-gray-900">{patientMap[dischargeModal]?.name}</strong> from active monitoring?
              Incident history will be retained in Firestore.
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => setDischargeModal(null)} className="flex-1 py-2.5 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => dischargePatient(dischargeModal)} className="flex-1 py-2.5 text-sm font-bold bg-[#dc2626] text-white rounded-xl hover:bg-red-700 transition-colors">
                Discharge
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
