// Typed wrappers for /api/iosdist/* endpoints. Goes through http.ts so the
// access-token refresh interceptor and credential-include settings apply.

import { request, requestJson } from "@networkextension/polar-ui-common/api/http";
import type {
  IOSApp,
  IOSAppCreateResponse,
  IOSAppDetailResponse,
  IOSAppListResponse,
  IOSASCApp,
  IOSASCBetaGroup,
  IOSASCConfig,
  IOSASCConfigStatusResponse,
  IOSCertificateListResponse,
  IOSCertificateUploadResponse,
  IOSDistType,
  IOSInstallTokenResponse,
  IOSProfileListResponse,
  IOSProfileUploadResponse,
  IOSSignSubmitResponse,
  IOSSignTask,
  IOSTestRequest,
  IOSVersionUploadResponse,
} from "./iosdist-types.js";

export async function fetchIOSApps() {
  return requestJson<IOSAppListResponse>("/api/iosdist/apps");
}

export async function createIOSApp(body: { name: string; bundle_id: string; description?: string }) {
  return requestJson<IOSAppCreateResponse>("/api/iosdist/apps", {
    method: "POST",
    body,
  });
}

export async function fetchIOSAppDetail(id: number) {
  return requestJson<IOSAppDetailResponse>(`/api/iosdist/apps/${id}`);
}

export async function deleteIOSApp(id: number) {
  return request(`/api/iosdist/apps/${id}`, { method: "DELETE" });
}

export async function uploadIOSAppIcon(id: number, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return requestJson<{ app: import("./iosdist-types.js").IOSApp }>(
    `/api/iosdist/apps/${id}/icon`,
    { method: "POST", body: fd },
  );
}

export async function updateIOSAppTestFlight(id: number, url: string) {
  return requestJson<{ app: import("./iosdist-types.js").IOSApp }>(
    `/api/iosdist/apps/${id}/testflight`,
    { method: "PUT", body: { url } },
  );
}

export async function uploadIOSVersion(
  appID: number,
  payload: {
    file: File;
    version: string;
    build?: string;
    notes?: string;
    distribution_type: IOSDistType;
  },
) {
  const fd = new FormData();
  fd.append("file", payload.file);
  fd.append("version", payload.version);
  fd.append("distribution_type", payload.distribution_type);
  if (payload.build) fd.append("build_number", payload.build);
  if (payload.notes) fd.append("release_notes", payload.notes);
  return requestJson<IOSVersionUploadResponse>(`/api/iosdist/apps/${appID}/versions`, {
    method: "POST",
    body: fd,
  });
}

export async function deleteIOSVersion(appID: number, versionID: number) {
  return request(`/api/iosdist/apps/${appID}/versions/${versionID}`, { method: "DELETE" });
}

export async function createIOSInstallToken(appID: number, versionID: number) {
  return requestJson<IOSInstallTokenResponse>(
    `/api/iosdist/apps/${appID}/versions/${versionID}/install-token`,
    { method: "POST" },
  );
}

// ---- Resource center: certificates + profiles ---------------------------

// ---- ASC bundle id + app creation (Phase 3 of iOS pipeline) ----

export type ASCBundleIDResponse = {
  bundle_id: { id: string; identifier: string; name: string; platform: string; seed_id?: string };
  reused: boolean;
};

export async function createASCBundleID(body: { identifier: string; name: string; platform?: string }) {
  return requestJson<ASCBundleIDResponse>("/api/iosdist/asc/bundle-ids", {
    method: "POST",
    body,
  });
}

export type ASCAppCreateResponse = {
  app: { id: string; bundle_id: string; name: string; sku: string };
};

export async function createASCApp(body: {
  bundle_id_resource_id: string;
  name: string;
  sku: string;
  primary_locale?: string;
}) {
  return requestJson<ASCAppCreateResponse>("/api/iosdist/asc/apps", {
    method: "POST",
    body,
  });
}

export async function fetchIOSCertificates() {
  return requestJson<IOSCertificateListResponse>("/api/iosdist/certificates");
}

export async function uploadIOSCertificate(payload: {
  file: File;
  name: string;
  kind: "distribution" | "development" | "enterprise" | "adhoc";
  password?: string;
  team_id?: string;
  common_name?: string;
  notes?: string;
}) {
  const fd = new FormData();
  fd.append("file", payload.file);
  fd.append("name", payload.name);
  fd.append("kind", payload.kind);
  if (payload.password) fd.append("password", payload.password);
  if (payload.team_id) fd.append("team_id", payload.team_id);
  if (payload.common_name) fd.append("common_name", payload.common_name);
  if (payload.notes) fd.append("notes", payload.notes);
  return requestJson<IOSCertificateUploadResponse>("/api/iosdist/certificates", {
    method: "POST",
    body: fd,
  });
}

export async function deleteIOSCertificate(id: number) {
  return request(`/api/iosdist/certificates/${id}`, { method: "DELETE" });
}

export async function fetchIOSProfiles() {
  return requestJson<IOSProfileListResponse>("/api/iosdist/profiles");
}

export async function uploadIOSProfile(payload: {
  file: File;
  name: string;
  kind: IOSDistType;
  app_id?: string;
  team_id?: string;
  notes?: string;
}) {
  const fd = new FormData();
  fd.append("file", payload.file);
  fd.append("name", payload.name);
  fd.append("kind", payload.kind);
  if (payload.app_id) fd.append("app_id", payload.app_id);
  if (payload.team_id) fd.append("team_id", payload.team_id);
  if (payload.notes) fd.append("notes", payload.notes);
  return requestJson<IOSProfileUploadResponse>("/api/iosdist/profiles", {
    method: "POST",
    body: fd,
  });
}

export async function deleteIOSProfile(id: number) {
  return request(`/api/iosdist/profiles/${id}`, { method: "DELETE" });
}

// ---- App Store Connect bridge -------------------------------------------

export async function fetchIOSASCConfigStatus() {
  return requestJson<IOSASCConfigStatusResponse>("/api/iosdist/asc/config");
}

export async function upsertIOSASCConfig(payload: {
  issuer_id: string;
  key_id: string;
  p8: File;
}) {
  const fd = new FormData();
  fd.append("issuer_id", payload.issuer_id);
  fd.append("key_id", payload.key_id);
  fd.append("p8", payload.p8);
  return requestJson<{ config: IOSASCConfig }>("/api/iosdist/asc/config", {
    method: "POST",
    body: fd,
  });
}

export async function deleteIOSASCConfig() {
  return request("/api/iosdist/asc/config", { method: "DELETE" });
}

export async function fetchIOSASCApps(bundleID?: string) {
  const q = bundleID ? `?bundle_id=${encodeURIComponent(bundleID)}` : "";
  return requestJson<{ apps: IOSASCApp[] | null }>(`/api/iosdist/asc/apps${q}`);
}

export async function fetchIOSASCBetaGroups(ascAppID?: string) {
  const q = ascAppID ? `?asc_app_id=${encodeURIComponent(ascAppID)}` : "";
  return requestJson<{ beta_groups: IOSASCBetaGroup[] | null }>(`/api/iosdist/asc/beta-groups${q}`);
}

export async function updateIOSAppASCBinding(id: number, body: { asc_app_id: string; asc_beta_group_id: string }) {
  return requestJson<{ app: IOSApp }>(`/api/iosdist/apps/${id}/asc-binding`, {
    method: "PUT",
    body,
  });
}

export async function inviteIOSAppTester(id: number, body: { email: string; first_name?: string; last_name?: string }) {
  return requestJson<{ ok: boolean }>(`/api/iosdist/apps/${id}/invite-tester`, {
    method: "POST",
    body,
  });
}

export async function syncIOSAppFromASC(id: number) {
  return requestJson<{ app: IOSApp; updated_fields: string[] }>(`/api/iosdist/apps/${id}/asc-sync`, {
    method: "POST",
  });
}

// ---- Public share controls + test request inbox ------------------------

export async function updateIOSAppVisibility(id: number, isPublic: boolean) {
  return requestJson<{ app: IOSApp }>(`/api/iosdist/apps/${id}/visibility`, {
    method: "PUT",
    body: { is_public: isPublic },
  });
}

export async function fetchIOSAppTestRequests(id: number) {
  return requestJson<{ requests: IOSTestRequest[] | null }>(`/api/iosdist/apps/${id}/test-requests`);
}

// ---- Re-sign pipeline ----------------------------------------------------

export async function submitIOSSignTask(
  appID: number,
  versionID: number,
  body: {
    cert_id: number;
    profile_id: number;
    new_bundle_id?: string;
    new_app_name?: string;
  },
) {
  return requestJson<IOSSignSubmitResponse>(
    `/api/iosdist/apps/${appID}/versions/${versionID}/sign`,
    { method: "POST", body },
  );
}

export async function fetchIOSSignTask(taskID: number) {
  return requestJson<{ task: IOSSignTask }>(`/api/iosdist/sign-tasks/${taskID}`);
}

export async function fetchIOSAppSignTasks(appID: number) {
  return requestJson<{ tasks: IOSSignTask[] | null }>(`/api/iosdist/apps/${appID}/sign-tasks`);
}

// iosdist M4: ASC status snapshot (review state, latest build, TF testers).

export interface IOSAppStatus {
  app_id: number;
  appstore_version: string;
  appstore_state: string;
  appstore_submitted_at?: string;
  appstore_released_at?: string;
  tf_build_version: string;
  tf_processing_state: string;
  tf_beta_state: string;
  tf_uploaded_at?: string;
  tf_expires_at?: string;
  beta_tester_count: number;
  synced_at: string;
  sync_error: string;
}

export async function fetchIOSAppStatus(id: number) {
  return requestJson<{ status: IOSAppStatus | null }>(`/api/iosdist/apps/${id}/status`);
}

export async function syncIOSAppStatusNow(id: number) {
  return requestJson<{ status: IOSAppStatus | null }>(`/api/iosdist/apps/${id}/status/sync`, {
    method: "POST",
  });
}
