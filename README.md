# 🎱 Laureano Billiards

Um jogo de billiards 3D desenvolvido em **Three.js** com física baseada em **cannon-es**, inspirado nas regras do **8-Ball Pool**. O projeto oferece partidas multiplayer locais utilizando celular como controle, com foco em física realista, arquitetura modular e alta fidelidade na simulação da mesa.

![Screenshot](./print.png)

---

# ✨ Funcionalidades

* 🎱 Física realista utilizando cannon-es
* 🪵 Mesa modelada com cushions e jaws físicos
* 🕳️ Caçapas com geometria realista
* 📱 Controle pelo celular
* 👥 Multiplayer local
* ⚡ Renderização otimizada
* 🎵 Sons do ambiente
* 🌙 Ambiente estilo pub/bar
* 🤖 IA para partidas

---

# 🎱 Regras Implementadas (8-Ball)

O jogo segue as regras clássicas do **8-Ball Pool**.

### Mesa aberta

* A mesa inicia aberta.
* O primeiro jogador que encaçapar uma bola válida define seu grupo:

  * 🔴 Lisas (1–7)
  * 🟡 Listradas (9–15)

---

### Turno

O jogador continua jogando quando:

* encaçapa uma bola do seu grupo;
* não comete nenhuma falta.

Caso contrário:

* passa a vez ao adversário.

---

### Bola do adversário

Caso uma bola do adversário seja encaçapada:

* ela permanece encaçapada;
* passa a contar para o adversário;
* se houver falta, o adversário recebe **bola na mão**.

---

### Bola branca

Quando a bola branca é encaçapada:

* ocorre falta;
* o adversário recebe **bola na mão**, podendo posicioná-la livremente para a próxima jogada.

---

### Bola 8

A bola 8 somente pode ser encaçapada após todas as bolas do grupo do jogador terem sido eliminadas.

Vitória:

* encaçapar a bola 8 corretamente após limpar seu grupo.

Derrota:

* encaçapar a bola 8 antes da hora;
* encaçapar a bola 8 junto com a bola branca;
* cometer falta na tacada em que a bola 8 for encaçapada.

---

### Física da mesa

A física da mesa busca reproduzir uma mesa real:

* cushions físicos independentes;
* jaws (quinas de borracha) nas seis caçapas;
* tabelas naturais nas quinas;
* nenhuma correção manual de posição das bolas;
* toda a resolução de colisões realizada pelo cannon-es.

---

# 🚀 Tecnologias

* Three.js
* cannon-es
* JavaScript
* HTML5
* CSS3
* WebSockets
* Node.js

---

# 📁 Estrutura

```text
.
├── assets/
│   ├── textures/
│   ├── models/
│   └── sounds/
│
├── js/
│   ├── editor.js
│   ├── objects.js
│   ├── lights.js
│   ├── controls.js
│   ├── physics.js
│   └── game.js
│
├── server.js
├── index.html
└── README.md
```

---

# ▶️ Executando

Instale as dependências:

```bash
npm install
```

Execute:

```bash
npm start
```

Abra:

```
http://localhost:3100
```

---

# 🎮 Controles

## Desktop

| Tecla  | Ação   |
| ------ | ------ |
| Mouse  | Mira   |
| Clique | Tacada |

## Mobile

* Controle de direção
* Ajuste de força
* Interface otimizada para touchscreen

![Screenshot](./print2.jpeg)

---

# 🏗️ Editor

O projeto possui um editor integrado para criação do ambiente.

É possível:

* mover objetos;
* rotacionar;
* duplicar;
* remover;
* adicionar novos elementos;
* salvar layouts.

---

# 💡 Iluminação

O ambiente utiliza múltiplas fontes de luz:

* Hemisphere Light
* Point Lights
* Ambient Light
* Iluminação quente inspirada em pubs

---

# 🎨 Cenário

Atualmente o ambiente possui:

* mesas de billiards;
* rack de tacos;
* troféus;
* quadros decorativos;
* bar;
* balcões;
* piso de madeira;
* paredes detalhadas.

---

# ⚙️ Performance

O projeto foi otimizado para manter alta taxa de quadros:

* reutilização de geometrias;
* materiais compartilhados;
* poucas luzes dinâmicas;
* renderização otimizada;
* baixo consumo de memória.

---

# 📌 Roadmap

## Física

* [x] Física completa das bolas
* [x] Colisão via cannon-es
* [x] Jaws físicos
* [x] Caçapas realistas
* [x] Física de tabelas

## Gameplay

* [x] Multiplayer local
* [x] IA
* [x] Regras principais do 8-Ball
* [x] Bola na mão
* [x] Definição automática de grupos
* [ ] Escolha de caçapa para a bola 8
* [ ] Detecção completa do primeiro contato da branca
* [ ] Todas as faltas oficiais da WPA

## Online

* [ ] Chat
* [ ] Ranking
* [ ] Torneios
* [ ] Matchmaking

---

# 👨‍💻 Autor

**Adriano Laureano**

GitHub:

https://github.com/sl4ureano

---

# 📄 Licença

MIT
