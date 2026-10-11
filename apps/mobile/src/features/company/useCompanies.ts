import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useAppStore } from '../../store/useAppStore';
import { currentEmail } from '../sync/account';
import { type Company, type CompanyError, myCompanies, toCompanyError } from './api';

export interface CompaniesState {
  /** undefined while loading */
  signedIn: boolean | undefined;
  companies: Company[];
  /** The picked company, else the first */
  company: Company | null;
  error: CompanyError | null;
  reload: () => Promise<void>;
}

/** The account's companies, re-read whenever the screen comes into view. */
export function useCompanies(): CompaniesState {
  const companyId = useAppStore((s) => s.companyId);
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState<CompanyError | null>(null);

  const reload = useCallback(async () => {
    const email = await currentEmail();
    setSignedIn(!!email);
    if (!email) return setCompanies([]);
    try {
      setCompanies(await myCompanies());
      setError(null);
    } catch (e) {
      setError(toCompanyError(e));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const company = companies.find((c) => c.id === companyId) ?? companies[0] ?? null;
  return { signedIn, companies, company, error, reload };
}
