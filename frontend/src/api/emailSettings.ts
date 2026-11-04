import { api } from "./client";

export type SmtpSecurity = "starttls" | "ssl" | "none";

/** Configuracao do servidor de e-mail. A senha nunca vem: so se ja foi configurada. */
export interface EmailSettings {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_security: SmtpSecurity | null;
  smtp_username: string | null;
  smtp_password_configured: boolean;
  smtp_from_email: string | null;
  smtp_from_name: string | null;
  email_allowed_domains: string | null;
  configured: boolean;
}

/** `smtp_password`: ausente = manter a atual; texto vazio = apagar; outro texto = trocar. */
export interface EmailSettingsUpdate {
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_security?: SmtpSecurity | null;
  smtp_username?: string | null;
  smtp_password?: string;
  smtp_from_email?: string | null;
  smtp_from_name?: string | null;
  email_allowed_domains?: string | null;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const { data } = await api.get("/settings/email/");
  return data;
}

export async function updateEmailSettings(input: EmailSettingsUpdate): Promise<EmailSettings> {
  const { data } = await api.put("/settings/email/", input);
  return data;
}

/** Qualquer pessoa logada: so diz se o envio por e-mail esta disponivel, nunca os dados do servidor. */
export async function getEmailStatus(): Promise<{ configured: boolean }> {
  const { data } = await api.get("/settings/email/status");
  return data;
}

export async function sendTestEmail(to: string): Promise<void> {
  await api.post("/settings/email/test", { to });
}
