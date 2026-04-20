import { useEffect, useState } from 'react';
import { getMacDownloadUrl, type MacArch } from '../constants/release';

function detectMacArch(): MacArch {
  if (!navigator.userAgent.includes('Mac')) return 'aarch64';
  if (navigator.userAgent.includes('Intel')) return 'x64';
  return 'aarch64';
}

export function useMacDownloadUrl(): string {
  const [arch, setArch] = useState<MacArch>(() => detectMacArch());

  useEffect(() => {
    if (!navigator.userAgent.includes('Mac')) return;

    const uaData = (
      navigator as Navigator & {
        userAgentData?: {
          getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
        };
      }
    ).userAgentData;

    if (uaData?.getHighEntropyValues) {
      void uaData.getHighEntropyValues(['architecture']).then((values) => {
        if (values.architecture === 'x86') {
          setArch('x64');
        }
      });
    }
  }, []);

  return getMacDownloadUrl(arch);
}
