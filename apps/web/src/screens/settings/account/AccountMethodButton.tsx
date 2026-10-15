import type { ReactElement } from "react";
import type { AccountProvider } from "../../../api/accountMethods";

export function AccountMethodButton(props: Readonly<{ provider: AccountProvider | "email"; label: string; disabled: boolean; onClick: () => void; testId: string }>): ReactElement {
  return <button type="button" className={`account-method-button account-method-${props.provider}`} disabled={props.disabled} onClick={props.onClick} data-testid={props.testId}>
    <svg width="20" height="20" viewBox={props.provider === "google" ? "0 0 48 48" : "0 0 24 24"} aria-hidden="true" focusable="false">
      {props.provider === "google" ? <>
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.87 46.98 24.55z"/>
        <path fill="#FBBC05" d="M10.53 28.59A14.41 14.41 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </> : props.provider === "apple" ? <path fill="currentColor" d="M17.05 12.54c.03 3.17 2.78 4.22 2.81 4.23-.02.08-.44 1.51-1.45 2.99-.87 1.28-1.78 2.56-3.21 2.59-1.4.03-1.85-.83-3.45-.83-1.59 0-2.09.8-3.41.86-1.38.05-2.43-1.39-3.31-2.66-1.8-2.6-3.17-7.35-1.32-10.56a5.15 5.15 0 0 1 4.36-2.64c1.36-.03 2.64.92 3.46.92.83 0 2.38-1.14 4.01-.97.68.03 2.6.28 3.83 2.08-.1.06-2.28 1.33-2.25 3.99ZM14.42 4.75c.73-.88 1.22-2.11 1.09-3.33-1.05.04-2.32.7-3.07 1.58-.68.78-1.28 2.03-1.12 3.23 1.17.09 2.37-.6 3.1-1.48Z"/>
        : <g fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></g>}
    </svg> {props.label}
  </button>;
}
