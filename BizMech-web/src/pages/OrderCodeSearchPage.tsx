import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { getPartApi } from '@/services/api/factory';
import { useSelectionStore } from '@/store/selectionStore';

export function OrderCodeSearchPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setPart = useSelectionStore((s) => s.setPart);
  const setSpec = useSelectionStore((s) => s.setSpec);
  const setDimension = useSelectionStore((s) => s.setDimension);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await getPartApi().searchByOrderCode(code.trim());
      if (!res) {
        setStatus(t('search.notFound'));
        return;
      }
      // Hydrate selection store, then jump to the main browser.
      setPart(res.spec.partCode);
      setSpec(res.spec, res.meta);
      setDimension(res.dimension);
      setStatus(
        t('search.found', { partName: res.spec.partName, partCode: res.spec.partCode }),
      );
      navigate('/');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-brand-600" />
            {t('search.title')}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('search.placeholder')}
              spellCheck={false}
            />
            <Button type="submit" disabled={loading}>
              {t('search.button')}
            </Button>
          </form>
          {status && (
            <div className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-800">
              {status}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
