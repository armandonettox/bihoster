import { useState, type FormEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { extractErrorMessage } from "../../api/client";
import UserAvatar from "../../components/UserAvatar";
import AccountSummary from "./AccountSummary";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "../../utils/passwordRules";

/** Logo "G" do Google, nas cores oficiais. */
function GoogleLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

const GOOGLE_LOCKED_HINT =
  "Nao e possivel editar: o seu login e feito pelo Google, entao esta informacao vem da sua conta Google.";

export default function AccountTab() {
  const { user, updateName, changePassword } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nameUnchanged = trimmedName === (user?.name ?? "");
  // Backend antigo nao manda o campo: nesse caso assume que da pra trocar
  const canChangePassword = user?.can_change_password !== false;
  const viaGoogle = user?.login_provider === "google" || user?.can_change_password === false;

  async function handleSaveName(event: FormEvent) {
    event.preventDefault();
    if (viaGoogle || !trimmedName || nameUnchanged) return;
    setNameError(null);
    setSavingName(true);
    try {
      await updateName(trimmedName);
      setName(trimmedName);
      showToast("Nome atualizado.");
    } catch (err: unknown) {
      setNameError(extractErrorMessage(err) || "Nao foi possivel salvar o nome.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    const problem = validateNewPassword(currentPassword, newPassword, confirmPassword);
    if (problem) {
      setPasswordError(problem);
      return;
    }
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast("Senha alterada. Outras sessoes abertas com a senha antiga foram encerradas.");
    } catch (err: unknown) {
      setPasswordError(extractErrorMessage(err) || "Nao foi possivel alterar a senha.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div>
      <div className="account-identity">
        <UserAvatar name={user?.name} pictureUrl={user?.picture_url} large />
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{user?.name}</div>
          <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>{user?.email}</div>
          {viaGoogle && (
            <span className="account-provider-badge" title="O login desta conta e feito pelo Google">
              <GoogleLogo />
              Verificado pelo Google
            </span>
          )}
        </div>
      </div>

      {user && <AccountSummary user={user} />}

      <div className="settings-section">
        <h2 className="settings-section-title">Meus dados</h2>
        <p className="settings-section-desc">
          {viaGoogle
            ? "O nome e o email vem da sua conta Google e nao podem ser alterados aqui."
            : "O nome aparece no menu da conta e nas listas de membros. O email identifica a sua conta e nao pode ser alterado aqui."}
        </p>

        <form onSubmit={handleSaveName} style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field" title={viaGoogle ? GOOGLE_LOCKED_HINT : undefined}>
            Nome
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              autoComplete="name"
              required
              readOnly={viaGoogle}
              disabled={viaGoogle}
            />
          </label>
          <label
            className="field"
            title={viaGoogle ? GOOGLE_LOCKED_HINT : "O email identifica a sua conta e nao pode ser alterado."}
          >
            Email
            <input className="input" value={user?.email ?? ""} readOnly disabled />
          </label>
          {nameError && <p className="auth-error">{nameError}</p>}
          {!viaGoogle && (
            <div>
              <button type="submit" className="btn btn-primary" disabled={savingName || !trimmedName || nameUnchanged}>
                {savingName ? "Salvando..." : "Salvar nome"}
              </button>
            </div>
          )}
        </form>
      </div>

      <div className="settings-section">
        <h2 className="settings-section-title">Senha</h2>
        {canChangePassword ? (
          <>
            <p className="settings-section-desc">
              Ao trocar a senha, as outras sessoes abertas com a senha antiga (outros navegadores, telas de TV)
              deixam de funcionar e pedem login de novo. A sua continua aberta.
            </p>

            <form
              onSubmit={handleChangePassword}
              style={{ maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}
            >
              <label className="field">
                Senha atual
                <input
                  className="input"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="field">
                Nova senha
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
                <span style={{ fontWeight: 400, fontSize: 12 }}>Pelo menos {MIN_PASSWORD_LENGTH} caracteres.</span>
              </label>
              <label className="field">
                Confirmar nova senha
                <input
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
              {passwordError && (
                <p className="auth-error" role="alert">
                  {passwordError}
                </p>
              )}
              <div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword}
                >
                  {savingPassword ? "Alterando..." : "Alterar senha"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <p className="settings-section-desc">
            A sua conta entra pelo Google, entao nao ha senha do BIHoster para trocar. A senha e gerenciada na sua
            conta Google.
          </p>
        )}
      </div>
    </div>
  );
}
