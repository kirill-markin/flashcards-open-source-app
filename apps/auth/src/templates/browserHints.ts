// Auth-origin storage only. No value in this module grants account or session authority.
export const browserHintStorageScript = `
  var browserHints = (function() {
    const generationKey = "nibomo-auth-hint-generation-v1";
    const preferenceKey = "nibomo-auth-hint-preference-v1";
    const hintKey = "nibomo-auth-hint-v1";
    const attemptKey = "nibomo-auth-hint-attempt-v1";
    const acceptedKey = "nibomo-auth-accepted-method-v1";
    const lifetimeMs = 30 * 60 * 1000;

    function storageError() {
      return new Error("Browser sign-in hints could not access site storage. Allow site data for this auth origin, then retry remembering or forgetting.");
    }

    function read(storage, key) {
      try { return storage.getItem(key); } catch { throw storageError(); }
    }

    function write(storage, key, value) {
      try { storage.setItem(key, value); } catch { throw storageError(); }
    }

    function remove(storage, key) {
      try { storage.removeItem(key); } catch { throw storageError(); }
    }

    function local() {
      try { return window.localStorage; } catch { throw storageError(); }
    }

    function session() {
      try { return window.sessionStorage; } catch { throw storageError(); }
    }

    function generation() {
      const value = read(local(), generationKey);
      if (value === null) return "initial";
      if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error("Browser sign-in hint generation is invalid. Forget saved sign-in information and retry.");
      return value;
    }

    function parse(value) {
      try { return JSON.parse(value); } catch { throw new Error("Browser sign-in information is damaged. Forget saved sign-in information and retry."); }
    }

    function method(value) {
      return value === "email" || value === "google" || value === "apple";
    }

    function email(value) {
      return typeof value === "string" && value.length <= 256 && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
    }

    function validHint(value) {
      if (!value || typeof value !== "object" || !method(value.method)) return false;
      if (value.method === "email") return email(value.email);
      if (!email(value.recoveryEmail) || (value.providerEmail !== null && !email(value.providerEmail))) return false;
      const relationship = value.providerEmail === null ? "missing"
        : value.providerEmail === value.recoveryEmail ? "matches_recovery" : "different_from_recovery";
      return value.emailRelationship === relationship;
    }

    function validBinding(value) {
      return value && typeof value === "object" && typeof value.subject === "string"
        && value.subject.length > 0 && value.subject.length <= 200
        && Number.isSafeInteger(value.authTime) && value.authTime >= 0;
    }

    function copyHint(value) {
      return value.method === "email" ? { method: "email", email: value.email }
        : { method: value.method, recoveryEmail: value.recoveryEmail,
          providerEmail: value.providerEmail, emailRelationship: value.emailRelationship };
    }

    function readHint() {
      const value = read(local(), hintKey);
      if (value === null) return null;
      const stored = parse(value);
      if (!stored || stored.generation !== generation()) return null;
      if (!validHint(stored.hint)) throw new Error("Saved sign-in hint is invalid. Forget saved sign-in information and retry.");
      return copyHint(stored.hint);
    }

    function isRemembering() { return read(local(), preferenceKey) === generation(); }

    function enableRemembering() {
      return exclusive(function() { write(local(), preferenceKey, generation()); });
    }

    async function exclusive(action) {
      if (!navigator.locks) throw new Error("This browser cannot safely remember or forget sign-in hints across tabs. Update the browser and retry.");
      const controller = new AbortController();
      const timeout = window.setTimeout(function() { controller.abort(); }, 2000);
      try { return await navigator.locks.request("nibomo-auth-hints-v1", { signal: controller.signal }, action); }
      catch (error) {
        if (controller.signal.aborted) throw new Error("Browser sign-in hint storage is busy in another tab. Close that tab and retry.");
        throw error;
      } finally { window.clearTimeout(timeout); }
    }

    function beginAttempt(actualMethod) {
      if (!method(actualMethod)) throw new Error("Sign-in hint method is invalid.");
      write(session(), attemptKey, JSON.stringify({ generation: generation(), method: actualMethod, startedAt: Date.now() }));
    }

    function acceptStored(result) {
      if (!result || result.ok !== true || !validHint(result.signInHint)) throw new Error("Accepted sign-in hint is invalid.");
      const raw = read(session(), attemptKey);
      if (raw === null) return;
      const attempt = parse(raw);
      remove(session(), attemptKey);
      if (!attempt || attempt.generation !== generation()) return;
      if (attempt.method !== result.signInHint.method || !Number.isSafeInteger(attempt.startedAt)
        || attempt.startedAt > Date.now() || Date.now() - attempt.startedAt > lifetimeMs) {
        throw new Error("Sign-in hint attempt is obsolete. Sign in again to record the current method.");
      }
      // Older servers and legacy sessions provide no original authentication time.
      if (result.acceptedSession === undefined) return;
      if (!validBinding(result.acceptedSession)) throw new Error("Accepted sign-in context is invalid.");
      const accepted = { generation: attempt.generation, method: attempt.method,
        subject: result.acceptedSession.subject, authTime: result.acceptedSession.authTime, acceptedAt: Date.now() };
      write(session(), acceptedKey, JSON.stringify(accepted));
      if (read(local(), preferenceKey) === attempt.generation) {
        write(local(), hintKey, JSON.stringify({ generation: attempt.generation, hint: copyHint(result.signInHint) }));
      }
    }

    function accept(result) { return exclusive(function() { acceptStored(result); }); }

    function consume(current) {
      const raw = read(session(), acceptedKey);
      if (raw === null) return null;
      remove(session(), acceptedKey);
      const accepted = parse(raw);
      if (!accepted || accepted.generation !== generation()) return null;
      if (!method(accepted.method) || !validBinding(accepted) || !Number.isSafeInteger(accepted.acceptedAt)) {
        throw new Error("Pending sign-in context is invalid. Forget saved sign-in information and retry.");
      }
      if (!validBinding(current) || accepted.subject !== current.subject || accepted.authTime !== current.authTime
        || accepted.acceptedAt > Date.now() || Date.now() - accepted.acceptedAt > lifetimeMs) return null;
      return accepted.method;
    }

    function forgetStored() {
      write(local(), generationKey, window.crypto.randomUUID());
      remove(local(), preferenceKey);
      remove(local(), hintKey);
      remove(session(), attemptKey);
      remove(session(), acceptedKey);
    }

    function forget() { return exclusive(forgetStored); }

    window.addEventListener("storage", function(event) {
      if (event.key !== generationKey) return;
      try {
        remove(session(), attemptKey);
        remove(session(), acceptedKey);
      } catch (error) { reportFailure(error); }
    });

    function reportFailure(error) {
      const message = error instanceof Error ? error.message : "Browser sign-in hints failed. Allow auth site data and retry.";
      console.error(message);
      window.dispatchEvent(new CustomEvent("nibomo-auth-hint-error", { detail: message }));
    }

    function beginOptional(actualMethod) {
      try { beginAttempt(actualMethod); } catch (error) { reportFailure(error); }
    }

    async function acceptOptional(result) {
      try { await accept(result); return true; } catch (error) { reportFailure(error); return false; }
    }

    return { readHint, isRemembering, enableRemembering, beginAttempt, accept, consume, forget, beginOptional, acceptOptional };
  })();
`;
