<script lang="ts">
	import { session } from './token.svelte';

	/**
	 * PAT entry — ARCHITECTURE.md §8, PLAN.md Phase 0.
	 *
	 * A single gate at the shell, not a router-level guard. Phase 9 replaces
	 * the guard, Phase 10 replaces the token; neither should have to touch
	 * a route to do it.
	 */
	let value = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy || value.trim() === '') return;

		busy = true;
		error = null;

		const result = await session.signIn(value);
		if (result.ok) {
			value = '';
		} else {
			error = result.error.message;
		}
		busy = false;
	}
</script>

<div class="gate">
	<form class="card" onsubmit={submit}>
		<h1>Connect a token</h1>
		<p class="lede">
			Octant talks to <span class="mono">api.github.com</span> directly from this browser. There is no
			server, so the token stays here — in IndexedDB, on this device.
		</p>

		<label class="field">
			<span class="lbl">Personal access token</span>
			<input
				class="mono"
				type="password"
				bind:value
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				placeholder="github_pat_…"
				disabled={busy}
			/>
		</label>

		{#if error}
			<p class="err" role="alert">{error}</p>
		{/if}

		<button class="go" type="submit" disabled={busy || value.trim() === ''}>
			{busy ? 'Validating…' : 'Validate and continue'}
		</button>

		<p class="note">
			Use a <a
				href="https://github.com/settings/personal-access-tokens/new"
				target="_blank"
				rel="noreferrer noopener">fine-grained token</a
			>
			with the narrowest scope that works: <b>Contents</b>, <b>Metadata</b> and
			<b>Pull requests</b>, all read-only, on the repositories you actually read. Give it a short
			expiry — a token in browser storage is only as safe as its blast radius.
		</p>
	</form>
</div>

<style>
	.gate {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: var(--bg);
	}

	.card {
		width: min(420px, 100%);
		background: var(--panel);
		border: 1px solid var(--bd);
		border-radius: var(--frame-radius);
		padding: 24px;
	}

	h1 {
		font-size: 15px;
		font-weight: 600;
		margin: 0 0 8px;
	}

	.lede {
		margin: 0 0 20px;
		color: var(--tx2);
	}

	.lede .mono {
		color: var(--tx2);
	}

	.field {
		display: block;
		margin-bottom: 12px;
	}

	.lbl {
		display: block;
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		margin-bottom: 6px;
	}

	input {
		width: 100%;
		background: var(--bg);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 7px 10px;
		color: var(--tx);
		transition: border-color 120ms;
	}

	input::placeholder {
		color: var(--tx3);
	}

	input:hover:not(:disabled) {
		border-color: var(--bd2);
	}

	input:disabled {
		color: var(--tx3);
	}

	.err {
		margin: 0 0 12px;
		font-size: 12px;
		color: var(--no);
	}

	.go {
		width: 100%;
		background: var(--acc);
		color: #fff;
		font-weight: 500;
		border-radius: var(--radius-pill);
		padding: 7px 10px;
		transition: opacity 120ms;
	}

	.go:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.note {
		margin: 20px 0 0;
		font-size: 12px;
		color: var(--tx3);
		line-height: 1.6;
	}

	.note b {
		font-weight: 500;
		color: var(--tx2);
	}

	.note a {
		color: var(--acc-tx);
	}

	.note a:hover {
		text-decoration: underline;
	}
</style>
