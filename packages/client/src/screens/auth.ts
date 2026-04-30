export function setupAuthScreen(opts: {
    elements: {
        nameInput: HTMLInputElement;
        emailInput: HTMLInputElement;
        passwordInput: HTMLInputElement;
        submitBtn: HTMLButtonElement;
        toggleBtn: HTMLButtonElement;
        guestBtn: HTMLButtonElement;
        errorDiv: HTMLElement;
    };
    onSuccess: (data: { userId?: number; role?: string }) => void;
    onGuestSuccess: (universeId: number) => void;
}) {
    const { elements, onSuccess, onGuestSuccess } = opts;
    let isLogin = false;

    function updateAuthMode() {
        elements.nameInput.style.display = isLogin ? 'none' : '';
        elements.submitBtn.textContent = isLogin ? 'Log in' : 'Register';
        elements.toggleBtn.textContent = isLogin
            ? "Don't have an account? Register"
            : 'Already have an account? Log in';
        elements.errorDiv.textContent = '';
    }

    async function handleAuth() {
        elements.errorDiv.textContent = '';
        const email = elements.emailInput.value.trim();
        const password = elements.passwordInput.value;
        const name = elements.nameInput.value.trim();

        if (!email || !password || (!isLogin && !name)) {
            elements.errorDiv.textContent = 'All fields are required.';
            return;
        }

        const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
        const body = isLogin ? { email, password } : { name, email, password };

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) {
                elements.errorDiv.textContent = data.error || 'Something went wrong.';
                return;
            }
            onSuccess(data);
        } catch {
            elements.errorDiv.textContent = 'Could not reach server.';
        }
    }

    async function handleGuest() {
        elements.errorDiv.textContent = '';
        elements.guestBtn.disabled = true;
        try {
            const res = await fetch('/api/auth/guest', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
                elements.errorDiv.textContent = data.error || 'Could not create guest session.';
                return;
            }
            // Guest path bypasses universe-select and jumps straight into the
            // game with the universe id the server picked/bootstrapped.
            onGuestSuccess(data.universeId);
        } catch {
            elements.errorDiv.textContent = 'Could not reach server.';
        } finally {
            elements.guestBtn.disabled = false;
        }
    }

    elements.toggleBtn.addEventListener('click', () => {
        isLogin = !isLogin;
        updateAuthMode();
    });
    elements.submitBtn.addEventListener('click', handleAuth);
    elements.guestBtn.addEventListener('click', handleGuest);
    elements.passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAuth();
    });

    updateAuthMode();
}
