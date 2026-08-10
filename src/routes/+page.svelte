<script lang="ts">
	import { page } from '$app/state';
	import HomeScreen from '$lib/home/HomeScreen.svelte';
	import { parseHome } from '$lib/nav/paths';

	/**
	 * Where the app opens: your repositories, and the pull requests in flight
	 * that have your name on them.
	 *
	 * This replaces the `owner/name` entry screen. Which of the two lists is
	 * shown is a query parameter rather than a segment — the line `nav/paths.ts`
	 * draws everywhere: a scope is a segment because it names a different object,
	 * and a view is a parameter because it narrows what is shown of one.
	 */
	const address = $derived(parseHome(page.url.searchParams));
</script>

<HomeScreen {address} />
