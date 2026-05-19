<script setup lang="ts">
const emit = defineEmits(['input', 'delete', 'clear']);

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', '⌫'];

const handleKey = (key: string) => {
  if (key === '⌫') emit('delete');
  else if (key === 'Clear') emit('clear');
  else emit('input', key);
};
</script>

<template>
  <div class="numpad-grid">
    <button 
      v-for="key in keys" 
      :key="key"
      class="numpad-key"
      :class="{ 'key-special': key === 'Clear' || key === '⌫' }"
      @click="handleKey(key)"
    >
      {{ key }}
    </button>
  </div>
</template>

<style scoped>
.numpad-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  width: 100%;
  max-width: 450px;
}

.numpad-key {
  height: 5.5rem;
  font-size: 2rem;
  font-weight: 700;
  border-radius: 1rem;
  border: none;
  background-color: var(--card-bg);
  color: var(--text-color);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s;
}

.numpad-key:active {
  transform: scale(0.92);
  background-color: var(--primary);
  color: white;
}

.key-special {
  font-size: 1.5rem;
  background-color: rgba(100, 116, 139, 0.1);
}

@media (prefers-color-scheme: dark) {
  .numpad-key {
    background-color: #334155;
  }
}
</style>
