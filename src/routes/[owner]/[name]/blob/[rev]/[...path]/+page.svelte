<script lang="ts">
	import { page } from '$app/state';
	import FileScreen from '$lib/file/FileScreen.svelte';
	import { parseFile } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';

	/**
	 * A file at a revision. `/blame/…` is the same screen with the gutter on —
	 * two addresses because they are two things you send to someone, not one
	 * thing with a switch on it.
	 */
	const address = $derived(parseFile(page.params, false));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<FileScreen {address} />
