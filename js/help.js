
// === SECURITY & PRIVACY SECTION INTEGRATION ===

function buildSecuritySection() {
  return _helpIntroCard(
    'Segurança e Privacidade dos seus dados',
    '🛡️',
    'No FinTrack, seus dados financeiros são tratados com o mais alto nível de responsabilidade. Apenas você tem acesso às suas informações, com transparência total sobre armazenamento e proteção.',
    '#16a34a'
  )
  +
  _createHelpSection(
    'Como protegemos suas informações',
    [
      {
        title: '🔐 Autenticação segura',
        content: 'Sessões protegidas com tokens criptografados. Apenas usuários autenticados acessam os dados.'
      },
      {
        title: '🧱 Isolamento de dados (RLS)',
        content: 'Cada usuário acessa apenas seus próprios dados através de Row Level Security.'
      },
      {
        title: '🔒 Criptografia',
        content: 'Todos os dados trafegam com HTTPS/TLS e são armazenados de forma segura.'
      },
      {
        title: '🧠 Arquitetura moderna',
        content: 'Arquitetura baseada em serviços (Supabase + Web App), reduzindo riscos.'
      },
      {
        title: '👁️ Controle total',
        content: 'Você pode editar ou excluir seus dados a qualquer momento.'
      }
    ]
  )
  +
  _createHelpSection(
    'Política de Privacidade',
    [
      {
        title: '📌 Coleta de dados',
        content: 'Coletamos apenas dados necessários para funcionamento do app.'
      },
      {
        title: '🎯 Uso das informações',
        content: 'Seus dados são usados exclusivamente para funcionalidades do sistema.'
      },
      {
        title: '🤝 Compartilhamento',
        content: 'Não vendemos nem compartilhamos seus dados com terceiros.'
      },
      {
        title: '🧾 Armazenamento',
        content: 'Dados armazenados em ambiente seguro com controle de acesso.'
      },
      {
        title: '❌ Exclusão',
        content: 'Você pode excluir seus dados a qualquer momento.'
      },
      {
        title: '🔄 Atualizações',
        content: 'A política pode evoluir mantendo transparência.'
      }
    ]
  )
  +
  _createHelpSection(
    'Seus direitos como usuário',
    [
      {
        title: '📤 Exportação de dados',
        content: 'Você poderá exportar seus dados em formato estruturado.'
      },
      {
        title: '🗑️ Exclusão de conta',
        content: 'Você pode solicitar a exclusão completa da sua conta.'
      }
    ]
  );
}

// Hook to existing help rendering
function integrateSecuritySection(originalContent) {
  return originalContent + buildSecuritySection();
}
