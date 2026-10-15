import type {
  MyCertificateDto,
  RevocationCategory,
  StaffCertificateDto,
} from '../../features/certificate/lifecycle';
import { postAction } from './action';
import { getJson } from './staff';

/**
 * Clientes do ciclo de vida do certificado (M7-04). A interface só mostra e envia; quem decide dono, estado, grant,
 * reautenticação e integridade do arquivo é o servidor.
 */
export const fetchMyCertificates = async () =>
  (await getJson<{ certificates: MyCertificateDto[] }>('/api/me/certificates')).certificates;

/** O PDF só sai por esta rota autenticada (o servidor confere o dono e o hash); não existe URL pública. */
export const certificateDownloadHref = (id: string) => `/api/me/certificates/${id}/download`;

export const fetchStaffCertificates = async () =>
  (await getJson<{ certificates: StaffCertificateDto[] }>('/api/staff/certificates')).certificates;

export const revokeCertificate = (id: string, category: RevocationCategory, note: string) =>
  postAction(`/api/staff/certificates/${id}/revoke`, { category, note });

export const reissueCertificate = (id: string, reason: string) =>
  postAction<{ certificateId: string }>(`/api/staff/certificates/${id}/reissue`, { reason });

export const retryCertificate = (id: string) =>
  postAction(`/api/staff/certificates/${id}/retry`, {});
