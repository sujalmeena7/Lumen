'use client';

import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function CredentialForm({ onClose }: { onClose: () => void }) {
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey, label }),
      });

      if (res.ok) {
        setApiKey('');
        setLabel('');
        router.refresh();
        onClose();
      } else if (res.status === 202) {
        const data = await res.json();
        alert(
          data.status === 'pending_approval'
            ? 'This workspace requires admin approval for credential changes. Your request has been submitted for review.'
            : 'Submitted for review.',
        );
        setApiKey('');
        setLabel('');
        onClose();
      } else {
        alert('Failed to save credential');
      }
    } catch {
      alert('Error saving credential');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex gap-3 text-blue-200/90 items-start mb-6">
        <ShieldAlert size={18} className="shrink-0 mt-0.5 text-blue-400" />
        <p className="text-xs">
          Your provider keys are securely encrypted at rest using envelope encryption. They are never logged, nor returned in any API responses.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="glass-input w-full appearance-none"
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="groq">Groq</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">API Key</label>
        <input
          type="password"
          required
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="glass-input w-full"
          placeholder="sk-..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">Label (Optional)</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="glass-input w-full"
          placeholder="e.g. Prod Account"
        />
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-white/10 mt-6">
        <button type="button" onClick={onClose} className="btn-secondary">
          Cancel
        </button>
        <button type="submit" disabled={loading || !apiKey} className="btn-primary">
          {loading ? 'Saving...' : 'Save Credential'}
        </button>
      </div>
    </form>
  );
}
