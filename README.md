# 🎱 Laureano Billiards

É um jogo de sinuca 3D desenvolvido em **Three.js** com física baseada em **cannon-es**, inspirado nas regras do **8-Ball Pool**. O projeto foi construído com foco em física realista, arquitetura modular e alta fidelidade na simulação da mesa.

Além do controle tradicional via teclado e mouse, controle pelo celular, o jogo também oferece um modo de **controle por visão computacional**, onde uma webcam ou um smartphone funciona como uma câmera de rastreamento semelhante ao Kinect, permitindo controlar a partida apenas com gestos das mãos. Todo o processamento é realizado diretamente no navegador, sem necessidade de hardware dedicado.

![Screenshot](./print.png)

---

# ✨ Funcionalidades

* 🎱 Física realista 
* 🪵 Mesa na mesma proporção que a real
* 🕳️ Caçapas com geometria realista
* 📱 Controle pelo celular
* 👁️ Controle por visão computacional
* 👥 Multiplayer local
* ⚡ Renderização otimizada
* 🎵 Sons do ambiente
* 🌙 Ambiente inspirado em pubs e bares
* 🤖 IA para partidas

---


# 🚀 Tecnologias

* Three.js
* cannon-es
* JavaScript
* HTML5
* CSS3
* HTML5 Canvas
* MediaPipe Hand Landmarker
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

Abra no navegador:

```
http://localhost:3100
```

---

# 🎮 Controles

O jogo suporta duas formas de interação: **controle tradicional pelo celular** e **controle por visão computacional**.

## Desktop

| Tecla  | Ação   |
| ------ | ------ |
| Mouse  | Mira   |
| Clique | Tacada |
| Enter | Reposicionar a bola quando necessario |

## Mobile

O celular funciona como um controle remoto da mesa.

* Controle da direção da mira.
* Ajuste da força da tacada.
* Interface otimizada para touchscreen.

![Controle Mobile](./print2.jpeg)

## Visão Computacional

Além do controle tradicional, o jogo também pode ser jogado utilizando **visão computacional**.

Nesse modo, um smartphone permanece posicionado em frente ao jogador funcionando como uma câmera de rastreamento, permitindo controlar a partida apenas com movimentos das mãos, em uma experiência semelhante ao Kinect.

O rastreamento é realizado em tempo real utilizando **MediaPipe Hand Landmarker**, enquanto toda a interpretação dos gestos acontece diretamente no navegador.

### Funcionamento

* A mão esquerda controla a direção da mira.
* A mão direita controla a força da tacada.
* Fechar a mão executa a tacada.
* A calibração define apenas a posição neutra das mãos.
* Botões da interface também podem ser acionados através de gestos.

Esse modo elimina a necessidade de controles físicos e oferece uma forma natural de interação durante a partida.

![Controle por Visão Computacional](./print3.gif)

---

# 🏗️ Editor

O projeto possui um editor integrado para personalização do ambiente.

É possível:

* mover objetos;
* rotacionar;
* duplicar;
* remover;
* adicionar novos elementos;
* salvar layouts.

---

# 💡 Iluminação

O ambiente utiliza múltiplas fontes de luz para reproduzir uma atmosfera inspirada em pubs e casas de sinuca.

* Hemisphere Light
* Point Lights
* Ambient Light
* Iluminação quente

---

# ⚙️ Performance

O projeto foi otimizado para manter uma alta taxa de quadros durante toda a partida.

* Reutilização de geometrias.
* Materiais compartilhados.
* Poucas luzes dinâmicas.
* Renderização otimizada.
* Baixo consumo de memória.

---

# 👨‍💻 Autor

**Adriano Laureano**

GitHub:

https://github.com/sl4ureano

---

# 📄 Licença

MIT
