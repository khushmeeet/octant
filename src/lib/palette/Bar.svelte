<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { RepoRef } from '$lib/source';
	import Icon from '$lib/ui/Icon.svelte';
	import { count } from '$lib/ui/format';
	import { GRAMMAR, parseQuery } from './grammar';
	import { isPaletteChord, lastPointer, palette } from '$lib/ui/palette.svelte';
	import { segments } from './rank';
	import { paletteResults } from './results.svelte';
	import type { Result } from './types';

	/**
	 * The palette — DESIGN.md §5, PLAN.md Phase 9.
	 *
	 * Centred overlay, query row, grouped results, footer carrying the prefix
	 * grammar and the index size. It is mounted only while it is open, which is
	 * what makes it free to have: the reads behind it exist for as long as it is
	 * on screen and are torn down with it.
	 *
	 * **It knows where you are from the URL and from nothing else.** The
	 * repository in the address bar is what `/` searches the files of and what
	 * `#412` names, so the palette reads the route rather than being handed a
	 * context by every screen — one place that can be wrong instead of nine.
	 *
	 * **Keys stop here.** Every screen listens on the window for `j`/`k`, `enter`
	 * and `esc`; while this is open they must hear none of it, so the query row
	 * stops propagation on everything. That is also why the chord is handled here
	 * as well as globally: ⌘K has to close what it opened.
	 */

	/** SvelteKit types params per route; the palette is on all of them at once. */
	const params = $derived(page.params as Record<string, string | undefined>);

	const repo = $derived<RepoRef | null>(
		params.owner && params.name ? { owner: params.owner, name: params.name } : null
	);

	/** `HEAD` in a URL means the default branch by omission — `nav/paths.ts`. */
	const rev = $derived(params.rev && params.rev !== 'HEAD' ? params.rev : null);

	let raw = $state('');
	let field = $state<HTMLInputElement | null>(null);
	let list = $state<HTMLDivElement | null>(null);

	const query = $derived(parseQuery(raw));
	const results = paletteResults(() => ({ repo, rev, query }));
	const rows = $derived(results.flat);

	/**
	 * Unlike every list in the app, the cursor starts *on* the first row rather
	 * than unset: a palette is a question with a best answer, and `enter` right
	 * after typing has to open it.
	 *
	 * Which is exactly why the pointer moves it on `pointermove` and not on
	 * `pointerenter`: the overlay opens under wherever the mouse was last left,
	 * so a row that renders beneath a stationary pointer would take the selection
	 * away from the top hit before you had typed anything.
	 */
	let cursor = $state(0);

	/**
	 * The row the cursor was deliberately put on, by arrow key or by pointer.
	 *
	 * Rows arrive as their lists do — the account's pull requests a moment after
	 * the palette opens, the file index a moment after the first keystroke — and
	 * a list that grows above the cursor moves what is under it. Holding the id
	 * rather than the index means `enter` opens the row you were looking at
	 * instead of whichever one has since slid into its place.
	 *
	 * Cleared on every keystroke: a new question has a new best answer, and that
	 * answer is the top row.
	 */
	let held = $state<string | null>(null);

	$effect(() => {
		if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
	});

	$effect(() => {
		if (held === null) return;

		const at = rows.findIndex((entry) => entry.id === held);
		if (at >= 0 && at !== cursor) cursor = at;
	});

	const active = $derived<Result | null>(rows[cursor] ?? null);

	// Resting on a row pays for what opening it would need — the same bargain
	// every hovered row in the app makes, and what keeps `enter` under 50ms.
	$effect(() => {
		active?.warm?.();
	});

	// Keep the cursor in view. `nearest` and no smooth scrolling: DESIGN.md §6,
	// nothing animates position.
	$effect(() => {
		const at = cursor;
		list?.querySelector<HTMLElement>(`[data-at="${at}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	onMount(() => {
		const previous = document.activeElement as HTMLElement | null;
		field?.focus();
		// Where you were before you asked. Closing the palette should put you
		// back, not on the body.
		return () => previous?.focus?.();
	});

	function step(delta: number): void {
		if (rows.length === 0) return;
		// Wraps, because a palette is a short list and the alternative is a dead
		// key at each end.
		cursor = (cursor + delta + rows.length) % rows.length;
		held = rows[cursor]?.id ?? null;
	}

	/**
	 * Where the pointer was before this overlay existed. Every row's move is
	 * measured against it, so an event that arrives at the pixel the mouse was
	 * already sitting on is what it is: the browser telling us the page moved,
	 * not the mouse. `movementX`/`movementY` would be the obvious test and are
	 * not a reliable one — they are zero for synthesised input of every kind.
	 */
	let seen = lastPointer();

	/** The pointer moving over a row is the same act as pressing down-arrow. */
	function point(at: number, event: PointerEvent): void {
		const from = seen;
		seen = { x: event.clientX, y: event.clientY };

		if (!from || (from.x === seen.x && from.y === seen.y)) return;

		cursor = at;
		held = rows[at]?.id ?? null;
	}

	function open(row: Result | null, event?: MouseEvent): void {
		if (!row) return;

		// A modified click belongs to the browser: a new tab is a reasonable thing
		// to want from a row that is a link.
		if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
		event?.preventDefault();

		palette.close();
		if (row.run) row.run();
		else if (row.href) void goto(row.href);
	}

	function onKeydown(event: KeyboardEvent): void {
		// The screen behind the palette does not get keys while it is open.
		event.stopPropagation();

		if (isPaletteChord(event)) {
			event.preventDefault();
			palette.close();
			return;
		}

		// Ctrl+N and Ctrl+P, because a hand that is already on a text field
		// often expects them. Everything else with a modifier is the browser's.
		if (event.ctrlKey && !event.metaKey && (event.key === 'n' || event.key === 'p')) {
			event.preventDefault();
			step(event.key === 'n' ? 1 : -1);
			return;
		}

		if (event.metaKey || event.ctrlKey || event.altKey) return;

		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				palette.close();
				break;
			case 'ArrowDown':
				event.preventDefault();
				step(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				step(-1);
				break;
			case 'Enter':
				event.preventDefault();
				open(active);
				break;
			case 'Tab':
				// Focus stays in the field: the rows are addressed by
				// `aria-activedescendant`, and there is nowhere else to go.
				event.preventDefault();
				break;
		}
	}

	function onInput(): void {
		// A new question has a new best answer.
		cursor = 0;
		held = null;
	}

	/** What the footer says about the file index — DESIGN.md §5. */
	const index = $derived.by<string>(() => {
		if (results.indexing) return 'indexing…';
		if (results.indexed === null) return '';
		return `${count(results.indexed)} files${results.truncated ? ', partial' : ''}`;
	});

	/** Row `n` within the flattened list, which is what the cursor counts in. */
	function indexOf(group: number, row: number): number {
		let at = 0;
		for (let i = 0; i < group; i++) at += results.groups[i].results.length;
		return at + row;
	}
</script>

{#snippet label(text: string, hits: number[] | undefined)}
	{#each segments(text, hits) as part, i (i)}
		{#if part.hit}<b>{part.text}</b>{:else}{part.text}{/if}
	{/each}
{/snippet}

{#snippet row(entry: Result, at: number)}
	{@const on = at === cursor}
	<svelte:element
		this={entry.href ? 'a' : 'button'}
		id="palette-row-{at}"
		class="row"
		class:sel={on}
		class:accent={entry.accent}
		role="option"
		aria-selected={on}
		tabindex="-1"
		data-at={at}
		href={entry.href}
		title={entry.title}
		type={entry.href ? undefined : 'button'}
		onclick={(event: MouseEvent) => open(entry, event)}
		onpointermove={(event: PointerEvent) => point(at, event)}
	>
		<Icon name={entry.icon} muted />
		<span class="what" class:mono={entry.mono}>{@render label(entry.label, entry.hits)}</span>
		{#if entry.meta}<span class="meta">{entry.meta}</span>{/if}
		{#if entry.note}<span class="note">{entry.note}</span>{/if}
	</svelte:element>
{/snippet}

<div class="over">
	<!-- The scrim is a button so dismissing by pointer is reachable without one:
	     it is off the tab order because `esc` is the keyboard's way out. -->
	<button
		class="scrim"
		tabindex="-1"
		aria-label="Close the command palette"
		onclick={() => palette.close()}
	></button>

	<div class="bar" role="dialog" aria-modal="true" aria-label="Command palette">
		<div class="q">
			<Icon name="search" muted />
			<input
				bind:this={field}
				bind:value={raw}
				class="field"
				type="text"
				role="combobox"
				aria-expanded="true"
				aria-controls="palette-list"
				aria-activedescendant={active ? `palette-row-${cursor}` : undefined}
				aria-autocomplete="list"
				aria-label="Search files, pull requests and repositories"
				placeholder="Go to a repository, a pull request, a file…"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				oninput={onInput}
				onkeydown={onKeydown}
			/>
			{#if repo}
				<span class="where mono" title="What / and # are scoped to">
					{repo.owner}/{repo.name}
				</span>
			{/if}
		</div>

		<div class="results" bind:this={list} id="palette-list" role="listbox" aria-label="Results">
			{#each results.groups as group, g (group.id)}
				<div class="group" role="group" aria-label={group.label}>
					<div class="head">{group.label}</div>
					{#if group.note}
						<p class="say">{group.note}</p>
					{/if}
					{#each group.results as entry, r (entry.id)}
						{@render row(entry, indexOf(g, r))}
					{/each}
				</div>
			{/each}

			{#if rows.length === 0 && !results.groups.some((group) => group.note)}
				<p class="say">
					{#if results.loading}
						<!-- A cache read, not a network one. Blank rather than a spinner
						     that would outlive the wait it explains — the same call the
						     boot screen makes. -->
						&nbsp;
					{:else if query.term}
						No match for <b class="mono">{query.term}</b>.
					{:else}
						Nothing to show yet.
					{/if}
				</p>
			{/if}
		</div>

		<div class="foot">
			<span class="keys">
				<b>↩</b> open <b>↑↓</b> move <b>esc</b> close
			</span>
			<span class="grammar">
				{#each GRAMMAR as hint (hint.prefix)}
					<span><b class="mono">{hint.prefix}</b>{hint.label}</span>
				{/each}
			</span>
			<span class="size">{index}</span>
		</div>
	</div>
</div>

<style>
	.over {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding: 12vh 16px 16px;
	}

	/* Scrim at 50% black — DESIGN.md §5. */
	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		cursor: default;
	}

	.bar {
		position: relative;
		width: min(540px, 90%);
		max-height: 70vh;
		display: flex;
		flex-direction: column;
		background: var(--raise);
		border: 1px solid var(--bd);
		border-radius: var(--radius-overlay);
		/* The one shadow in the app — DESIGN.md §8. */
		box-shadow: var(--shadow-overlay);
		overflow: hidden;
	}

	.q {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		height: 44px;
		flex: none;
		border-bottom: 1px solid var(--bd);
		color: var(--tx3);
	}

	.field {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		outline: none;
		font-size: 13px;
		color: var(--tx);
	}

	.field::placeholder {
		color: var(--tx3);
	}

	/* What `/` and `#` are scoped to. Not a pill: it is a label on the field. */
	.where {
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.results {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 0;
	}

	.group + .group {
		border-top: 1px solid var(--bd);
	}

	.head {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		padding: 8px 12px 4px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: var(--row-h);
		padding: 0 12px;
		text-align: left;
		color: var(--tx3);
		transition: background-color 120ms;
	}

	/**
	 * Keyboard and pointer selection look identical — DESIGN.md §6 — and here
	 * they are the same thing: moving the pointer moves the cursor, so there is
	 * no separate hover state to draw. A row does not light up merely because the
	 * overlay opened underneath a mouse that has not moved since.
	 */
	.row.sel {
		background: var(--sel);
	}

	.what {
		flex: none;
		max-width: 62%;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* The characters you typed. Weight, not colour: every colour in this app
	   already means exactly one thing — DESIGN.md §3. */
	.what :global(b) {
		font-weight: 600;
		color: var(--tx);
	}

	.row:not(.sel) .what {
		color: var(--tx2);
	}

	.row.accent .what :global(b),
	.row.accent .what {
		color: var(--acc-tx);
	}

	.meta {
		flex: 1;
		min-width: 0;
		font-size: 11.5px;
		color: var(--tx3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.note {
		margin-left: auto;
		padding-left: 8px;
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		white-space: nowrap;
	}

	.say {
		margin: 0;
		padding: 8px 12px 12px;
		font-size: 12px;
		color: var(--tx3);
	}

	.say b {
		font-weight: 500;
		color: var(--tx2);
	}

	/* Shortcut hints live here rather than in a persistent status bar —
	   DESIGN.md §6: discoverable while you are asking, invisible while reading. */
	.foot {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: none;
		height: 28px;
		padding: 0 12px;
		border-top: 1px solid var(--bd);
		background: var(--side);
		font-size: 11px;
		color: var(--tx3);
		overflow: hidden;
	}

	.foot b {
		font-weight: 400;
		color: var(--tx2);
	}

	.grammar {
		display: flex;
		gap: 8px;
		min-width: 0;
		overflow: hidden;
	}

	.grammar b {
		margin-right: 3px;
	}

	.size {
		margin-left: auto;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 560px) {
		.grammar,
		.where {
			display: none;
		}
	}
</style>
