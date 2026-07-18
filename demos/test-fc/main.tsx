import { useState } from 'react';
import ReactDOM from 'react-dom';

// function App() {
// 	const [num, setNum] = useState<number>(100);
// 	window.setNum = setNum;
// 	const [num2, update2] = useState<number>(150);
//
// 	console.log('num2', num2);
// 	return num === 3 ? <Child /> : <div>{num}</div>;
// }

// function App() {
// 	const [num, setNum] = useState<number>(100);
// 	window.setNum = setNum;
// 	const [num2, update2] = useState<number>(150);
//
// 	console.log('num2', num2);
// 	return <div onClick={() => setNum((_v) => _v + 1)}>{num}</div>;
// }

function App() {
	const [num, setNum] = useState<number>(100);
	// window.setNum = setNum;
	const arr =
		num % 2 === 0
			? [<li key="1">1</li>, <li key="2">2</li>, <li key="3">3</li>]
			: [<li key="3">3</li>, <li key="2">2</li>, <li key="1">1</li>];

	console.log('num', num);
	// return <ul onClick={() => setNum((_v) => _v + 1)}>{arr}</ul>;
	return (
		<ul
			onClick={() => {
				setNum((_v) => _v + 1);
				setNum((_v) => _v + 1);
				setNum((_v) => _v + 1);
			}}
		>
			<>
				<li key="1">1</li>
				<li key="2">2</li>
			</>
			<li key="3">3</li>
			<li key="4">4</li>
			{arr}
		</ul>
	);
}

function Child() {
	// const now = performance.now();
	// while (performance.now() - now < 4) {}
	return <li>big - 2121react</li>;
}

const root = ReactDOM.createRoot(document.querySelector('#root'));

root.render(<App />);
