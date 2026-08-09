<script lang="ts">
	/**
	 * The only avatar in the app. DESIGN.md §8 forbids them everywhere else and
	 * §5 asks for one here, and the exception is earned: a thread is the one
	 * surface where several people are speaking at once and telling them apart
	 * at a glance is the whole job of the column.
	 *
	 * It degrades to the initial rather than to a broken image. A repository can
	 * be private, a token can be scoped away from a user's avatar, and an
	 * account can be deleted — none of which is a reason for a comment to render
	 * with a hole in it. The initial is drawn first and the image covers it, so
	 * there is nothing to swap in and no layout to shift.
	 */
	interface Props {
		login: string | null;
		url: string | null;
		size?: number;
	}

	let { login, url, size = 18 }: Props = $props();

	let broken = $state(false);

	const initial = $derived((login ?? '?').charAt(0).toUpperCase());
</script>

<span class="av" style:--av="{size}px" aria-hidden="true">
	{initial}
	{#if url && !broken}
		<img
			src={url}
			alt=""
			loading="lazy"
			referrerpolicy="no-referrer"
			onerror={() => (broken = true)}
		/>
	{/if}
</span>

<style>
	.av {
		position: relative;
		width: var(--av);
		height: var(--av);
		border-radius: var(--radius-pill);
		background: var(--bd);
		color: var(--tx3);
		font-size: 10px;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		overflow: hidden;
	}

	img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
