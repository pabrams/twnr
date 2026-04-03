export function setupAuthScreen(
    elements: {
        nameInput: HTMLInputElement;
        emailInput: HTMLInputElement;
        passwordInput: HTMLInputElement;
        submitBtn: HTMLButtonElement;
        toggleBtn: HTMLButtonElement;
        errorDiv: HTMLElement;
    },
    onSuccess: () => void,
) {
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
            onSuccess();
        } catch {
            elements.errorDiv.textContent = 'Could not reach server.';
        }
    }

    elements.toggleBtn.addEventListener('click', () => {
        isLogin = !isLogin;
        updateAuthMode();
    });
    elements.submitBtn.addEventListener('click', handleAuth);
    elements.passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAuth();
    });

    updateAuthMode();
}
