document.addEventListener("DOMContentLoaded", async () => {

    // ==========================================
    // 0. CONFIGURAÇÃO SUPABASE
    // ==========================================
    const SUPABASE_URL = "https://dtfzvbtodlyyfokfgllv.supabase.co";
    const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0Znp2YnRvZGx5eWZva2ZnbGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDE0NDUsImV4cCI6MjA4MjM3NzQ0NX0.L6qGW1Bl8k0eQhvJL_IvGE3q7yVPGPELL2beiDLhQ_Y";

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // ==========================================
    // 🍞 SISTEMA DE TOAST (NOTIFICAÇÕES)
    // ==========================================
    window.showToast = (message, type = 'success') => {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const icons = {
            success: 'fa-circle-check',
            error: 'fa-circle-exclamation',
            info: 'fa-circle-info'
        };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <i class="fa-solid ${icons[type]}"></i>
            <span>${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.5s forwards';
            setTimeout(() => toast.remove(), 500);
        }, 4000);

        toast.addEventListener('click', () => toast.remove());
    };

    // ==========================================
    // 🔒 0.5 O PORTEIRO & O DONO (AUTH & RBAC)
    // ==========================================
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '../auth/login.html';
        return;
    }

    let perfilUsuario = null;
    try {
        const { data } = await supabase
            .from('moradores')
            .select('*')
            .eq('email', session.user.email)
            .maybeSingle();

        if (data) {
            perfilUsuario = data;
            atualizarSidebar(perfilUsuario);
        } else {
            console.warn("Usuário logado, mas sem perfil no banco.");
        }
    } catch (err) {
        console.log("Erro ao buscar perfil:", err);
    }

    const souODono = perfilUsuario && perfilUsuario.cargo === 'Dono';
    aplicarPermissoes(souODono);

    // Configura Logout
    const btnLogout = document.querySelector('.logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            await supabase.auth.signOut();
            window.location.href = '../auth/login.html';
        });
    }

    // ==========================================
    // 1. VARIÁVEIS GLOBAIS
    // ==========================================
    let moradoresCache = [];
    let idEditando = null;
    let emailParaDeletar = null;

    const tabelaBody = document.getElementById("lista-moradores");
    const modalCadastro = document.getElementById("modal-novo-morador");
    const modalExclusao = document.getElementById("modal-confirm-delete");
    const formMorador = document.getElementById("form-morador");


    // ==========================================
    // FUNÇÃO DE PERMISSÕES
    // ==========================================
    function aplicarPermissoes(isBoss) {
        if (!isBoss) {
            console.log("👁️ Modo Transparência: Morador vendo dados, mas sem editar.");
            const btnNovo = document.getElementById("btn-novo-morador");
            if (btnNovo) btnNovo.style.display = "none";
        } else {
            console.log("👑 O Dono CHEGOU! Controle total liberado.");
        }
    }

    // ==========================================
    // 🎭 MÁSCARAS E FORMATAÇÃO (CELULAR + BLOCO)
    // ==========================================

    // 1. Celular
    const inputCelular = document.getElementById("celular");
    const aplicarMascaraCelular = (event) => {
        let input = event.target;
        let v = input.value;
        v = v.replace(/\D/g, "");
        v = v.substring(0, 11);
        v = v.replace(/^(\d{2})(\d)/g, "($1) $2");
        v = v.replace(/(\d{5})(\d)/, "$1-$2");
        input.value = v;
    };
    if (inputCelular) inputCelular.addEventListener("input", aplicarMascaraCelular);

    // 2. Bloco (Força Maiúsculo visualmente)
    const inputBloco = document.getElementById("unidade-bloco");
    if (inputBloco) {
        inputBloco.addEventListener("input", (e) => {
            e.target.value = e.target.value.toUpperCase();
        });
    }


    // ==========================================
    // 2. SISTEMA DE EXCLUSÃO (VIA RPC / SQL)
    // ==========================================
    window.abrirModalExclusao = (email) => {
        emailParaDeletar = email;
        modalExclusao.classList.add("active");
    };

    window.fecharModalExclusao = () => {
        emailParaDeletar = null;
        modalExclusao.classList.remove("active");
    };

    document.getElementById("btn-confirm-delete").addEventListener("click", async () => {
        if (!emailParaDeletar) return;

        const btn = document.getElementById("btn-confirm-delete");
        const textoOriginal = btn.innerText;
        btn.innerText = "Exterminando...";
        btn.disabled = true;

        const { error } = await supabase.rpc('excluir_conta_completa', {
            email_alvo: emailParaDeletar
        });

        if (error) {
            showToast("Erro ao excluir: " + error.message, "error");
        } else {
            showToast("Usuário removido com sucesso!", "success");
            fecharModalExclusao();
            carregarMoradores();
        }

        btn.innerText = textoOriginal;
        btn.disabled = false;
    });


    // ==========================================
    // 3. CRUD (COM LÓGICA DE UNIDADE/BLOCO)
    // ==========================================

    async function carregarMoradores() {
        tabelaBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">Carregando...</td></tr>';

        const { data, error } = await supabase
            .from("moradores")
            .select("*")
            .order("id", { ascending: false });

        if (error) {
            console.error(error);
            showToast("Erro ao carregar lista.", "error");
            return;
        }

        moradoresCache = data;
        renderizarTabela();
        atualizarContadores();
    }

    async function salvarMorador(dados) {
        if (!souODono) {
            showToast("Sem permissão. Você não é o Dono.", "error");
            return;
        }

        const btnSalvar = formMorador.querySelector("button");
        const textoOriginal = btnSalvar.innerText;
        btnSalvar.innerText = "Salvando...";
        btnSalvar.disabled = true;

        // ======================================================
        // AQUI TÁ O PULO DO GATO: FORMATAÇÃO DA UNIDADE
        // ======================================================
        const num = document.getElementById("unidade-num").value.trim();
        const bl = document.getElementById("unidade-bloco").value.toUpperCase().trim();

        // Junta os dois campos no formato padrão
        dados.unidade = `${num} - Bloco ${bl}`;
        // ======================================================

        let error = null;

        if (idEditando) {
            // EDIÇÃO SINCRONIZADA (AUTH + PUBLIC)
            const emailAlvo = document.getElementById("email-novo").value;

            console.log("🔄 Sincronizando dados em Public + Auth...");
            const response = await supabase.rpc('atualizar_morador_completo', {
                email_alvo: emailAlvo,
                novo_nome: dados.nome,
                novo_celular: dados.celular,
                novo_tipo: dados.tipo,
                nova_unidade: dados.unidade, // Manda a string formatada
                novo_status: dados.status,
                nova_img: dados.img
            });
            error = response.error;
        } else {
            // CRIANDO NOVO
            dados.cargo = 'morador';
            const response = await supabase.from("moradores").insert([dados]);
            error = response.error;
        }

        if (error) {
            console.error(error);
            showToast("Erro: " + error.message, "error");
        } else {
            showToast(idEditando ? "Dados atualizados com sucesso!" : "Morador cadastrado com sucesso!", "success");
            await carregarMoradores();
            fecharModalCadastro();
        }

        btnSalvar.innerText = textoOriginal;
        btnSalvar.disabled = false;
    }

    // ==========================================
    // 4. RENDERIZAÇÃO
    // ==========================================
    function renderizarTabela() {
        tabelaBody.innerHTML = "";

        if (moradoresCache.length === 0) {
            tabelaBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Nenhum morador encontrado.</td></tr>';
            return;
        }

        moradoresCache.forEach((m) => {
            const tr = document.createElement("tr");
            const badgeClass = m.status === "ok" ? "status-ok" : "status-late";
            const badgeText = m.status === "ok" ? "Em dia" : "Atrasado";

            const botoesAcao = souODono
                ? `
                    <button class="action-btn" onclick="editarMorador(${m.id})"><i class="fa-regular fa-pen-to-square"></i></button>
                    <button class="action-btn" onclick="abrirModalExclusao('${m.email}')" style="color: #ef4444;"><i class="fa-regular fa-trash-can"></i></button>
                  `
                : `<span style="color:#cbd5e1; font-size:0.8rem;" title="Acesso Restrito"><i class="fa-solid fa-lock"></i></span>`;

            tr.innerHTML = `
                <td>
                    <div class="user-cell">
                        <img src="${m.img || 'https://ui-avatars.com/api/?name=User'}" class="user-avatar" alt="${m.nome}">
                        <div>
                            <strong>${m.nome}</strong><br>
                            <small style="color: #64748b;">${m.tipo}</small>
                        </div>
                    </div>
                </td>
                <td><strong>${m.unidade}</strong></td>
                <td>${m.celular}</td>
                <td><span class="status-badge ${badgeClass}">${badgeText}</span></td>
                <td>
                    ${botoesAcao}
                </td>
            `;
            tabelaBody.appendChild(tr);
        });
    }

    function atualizarContadores() {
        const unidadesCount = document.querySelector(".stat-card:nth-child(3) .stat-value");
        if (unidadesCount) unidadesCount.innerText = `${moradoresCache.length}/50`;
    }

    // ==========================================
    // 5. EVENTOS
    // ==========================================
    const btnNovoMorador = document.getElementById("btn-novo-morador");
    const btnFecharModal = document.querySelector(".close-modal");

    if (btnNovoMorador) {
        btnNovoMorador.addEventListener("click", (e) => {
            e.preventDefault();
            idEditando = null;
            formMorador.reset();

            // Libera e limpa o email
            const emailInput = document.getElementById("email-novo");
            if (emailInput) {
                emailInput.disabled = false;
                emailInput.style.backgroundColor = "rgba(255, 255, 255, 0.5)";
            }

            document.querySelector(".modal-header h3").innerText = "Novo Morador";
            modalCadastro.classList.add("active");
        });
    }

    function fecharModalCadastro() {
        modalCadastro.classList.remove("active");
    }
    if (btnFecharModal) btnFecharModal.addEventListener("click", fecharModalCadastro);

    if (formMorador) {
        formMorador.addEventListener("submit", (e) => {
            e.preventDefault();
            const nome = document.getElementById("nome").value;

            const emailInput = document.getElementById("email-novo").value;
            const emailLimpo = emailInput ? emailInput.toLowerCase().trim() : null;

            // REMOVI 'unidade' DAQUI - Ele é montado dentro do salvarMorador
            const dados = {
                nome: nome,
                email: emailLimpo,
                celular: document.getElementById("celular").value,
                tipo: document.getElementById("tipo").value,
                status: document.getElementById("status").value,
                img: `https://ui-avatars.com/api/?name=${nome}&background=random`,
            };
            salvarMorador(dados);
        });
    }

    // Edição (Agora separa Unidade e Bloco)
    window.editarMorador = (id) => {
        if (!souODono) return;

        const morador = moradoresCache.find((m) => m.id === id);
        if (!morador) return;

        idEditando = id;

        document.getElementById("nome").value = morador.nome;

        // Email travado na edição
        const emailInput = document.getElementById("email-novo");
        emailInput.value = morador.email || "";
        emailInput.disabled = true;
        emailInput.style.backgroundColor = "rgba(0, 0, 0, 0.05)";

        document.getElementById("celular").value = morador.celular;
        document.getElementById("tipo").value = morador.tipo;
        document.getElementById("status").value = morador.status;

        // ==========================================
        // SEPARA A STRING "101 - Bloco A"
        // ==========================================
        if (morador.unidade && morador.unidade.includes(" - Bloco ")) {
            const partes = morador.unidade.split(" - Bloco ");
            document.getElementById("unidade-num").value = partes[0];   // 101
            document.getElementById("unidade-bloco").value = partes[1]; // A
        } else {
            // Fallback se o dado for antigo
            document.getElementById("unidade-num").value = morador.unidade;
            document.getElementById("unidade-bloco").value = "";
        }

        document.querySelector(".modal-header h3").innerText = "Editar Morador";
        modalCadastro.classList.add("active");
    };

    // Navegação Sidebar
    const menuLinks = document.querySelectorAll(".sidebar-menu .menu-item");
    const sections = document.querySelectorAll(".view-section");

    menuLinks.forEach((link) => {
        link.addEventListener("click", (e) => {
            if (link.classList.contains("logout")) return;
            e.preventDefault();
            menuLinks.forEach((l) => l.classList.remove("active"));
            link.classList.add("active");

            const spanText = link.querySelector("span").innerText;
            const targetId = {
                "Visão Geral": "view-dashboard",
                "Relatórios": "view-dashboard",
                "Moradores": "view-moradores",
                "Reservas": "view-dashboard",
            }[spanText];

            sections.forEach((s) => {
                s.classList.remove("active");
                if (s.id === targetId) s.classList.add("active");
            });
        });
    });

    // ==========================================
    // 6. UI UPDATE (SIDEBAR)
    // ==========================================
    function atualizarSidebar(usuario) {
        if (!usuario) return;

        console.log("👤 Dados do User:", usuario);

        const nomeEl = document.getElementById("user-name");
        if (nomeEl) {
            const nomes = usuario.nome.split(' ');
            nomeEl.innerText = nomes.length > 1
                ? `${nomes[0]} ${nomes[nomes.length - 1]}`
                : nomes[0];
        }

        const roleEl = document.getElementById("user-role");
        if (roleEl) {
            if (usuario.cargo === 'admin' || usuario.cargo === 'Dono') {
                roleEl.innerText = "Síndico";
            } else {
                roleEl.innerText = usuario.tipo || "Condômino";
            }
        }

        const avatarEl = document.getElementById("user-avatar");
        if (avatarEl) {
            const nomes = usuario.nome.trim().split(" ");
            let iniciais = nomes[0].substring(0, 2);
            if (nomes.length > 1) {
                iniciais = nomes[0][0] + nomes[nomes.length - 1][0];
            }
            avatarEl.innerText = iniciais.toUpperCase();
        }
    }

    carregarMoradores();
});