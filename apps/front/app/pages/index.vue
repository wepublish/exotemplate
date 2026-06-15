<script lang="ts" setup>
  // The bare root carries no client period in the path. Redirect to the user's
  // default selection (last-used if still valid, else the newest period of the
  // first client) once the client list has loaded. Renders nothing until then —
  // the layout shows the login form while logged out.
  const selection = useClientSelection()
  const router = useRouter()

  watchEffect(() => {
    if (!selection.clients.length) return
    const id = selection.defaultClientPeriodId()
    if (id) router.replace(`/${id}/dashboard`)
  })
</script>

<template>
  <div />
</template>
