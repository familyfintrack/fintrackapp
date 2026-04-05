# FinTrack — Patch 18: Dark Mode Server Sync + Dream Cards Redesign

## Arquivos modificados

| Arquivo | Destino |
|---|---|
| `auth.js`   | `js/auth.js`  |
| `dreams.js` | `js/dreams.js` |
| `style.css` | `css/style.css` |

---

## 1. 🌙 Dark Mode — Persistência cross-device no servidor

### Como funciona agora

**Duas camadas de persistência:**

1. **localStorage** (`ft_dark_mode`) — aplicado *imediatamente* ao carregar a página, antes mesmo de qualquer JS da app. Elimina flash branco/escuro.

2. **Servidor** (`app_users.ui_settings.dark_mode`) — authoritative. Ao fazer login, o servidor sobrescreve o localStorage. Isso garante que ao abrir em outro dispositivo/browser o modo correto seja aplicado.

### Fluxo técnico

- `_loadCurrentUserContext()` — ao construir `currentUser`, lê `appUserRow.ui_settings.dark_mode` e chama `_applyDarkMode()` imediatamente. Zero round-trip extra (o campo já vem no SELECT existente de `app_users`).
- `toggleDarkMode()` — agora é `async`. Aplica localmente + dispara `_saveDarkModeToServer()` (fire-and-forget).
- `_saveDarkModeToServer()` — lê `ui_settings` atual, faz merge com `{ dark_mode: bool }` e salva via `UPDATE app_users SET ui_settings = ...`.
- `_syncDarkModeFromServer()` — chamado em `onLoginSuccess()` após bootApp como fallback de confirmação.

### Não requer migração SQL
`ui_settings` já é uma coluna `jsonb` em `app_users` — apenas um novo campo dentro do objeto.

---

## 2. 🌟 Cards de Sonho — Redesign completo

### Estrutura nova

```
drm-card
  drm-card-hero          ← gradiente por tipo, com glow e anel SVG radial
    drm-card-hero__inner
      drm-card-hero__left  ← emoji grande + título + tipo
      drm-card-hero__ring  ← SVG animado com % de progresso
    drm-card-hero__badge   ← status colorido por tipo
  drm-card-body
    drm-card-progress-row  ← acumulado | meta (dois números)
    drm-card-bar           ← barra linear fina com gradiente
    drm-card-chips         ← meses restantes, data alvo, aporte/mês, componentes
    drm-card-desc          ← descrição truncada em 2 linhas
    drm-card-actions       ← Ver detalhes (cor do tipo) | + Aporte | ⋯
```

### Paleta por tipo de sonho
| Tipo | Gradiente |
|---|---|
| Viagem | azul → índigo |
| Automóvel | laranja → vermelho |
| Imóvel | verde → esmeralda |
| Cirurgia | rosa → vermelho |
| Estudos | âmbar → laranja |
| Outro | violeta → índigo |

### Anel SVG de progresso
- SVG inline com dois círculos: trilha e preenchimento
- `stroke-dasharray` calculado em JS para exibir % exato
- Ícone 🏆 no centro para sonhos conquistados; `#` de progresso para os demais
- Cor do anel reflete estado: verde (conqusitado), cinza (pausado), cor do tipo (ativo)

### Botão "Ver detalhes" por tipo
- Background e border com cor do tipo (`--btn-color`) 
- Hover preenche com a cor sólida + box-shadow colorido
