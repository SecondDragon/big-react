import { useEffect, useState } from 'react';
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
	const [num, setNum] = useState<number>(0);
	// window.setNum = setNum;
	// @ts-ignore
	useEffect(() => {
		console.log('App mount');
	}, []);
	useEffect(() => {
		console.log('num change create', num);
		return () => {
			console.log('num change destroy');
		};
	}, [num]);

	console.log('num', num);
	// return <ul onClick={() => setNum((_v) => _v + 1)}>{arr}</ul>;
	return (
		<ul
			onClick={() => {
				setNum((_v) => _v + 1);
			}}
		>
			{num % 2 === 0 ? <Child /> : 'noop'}
		</ul>
	);
}

function Child() {
	useEffect(() => {
		console.log('Child mount');
		return () => {
			console.log('Child unmount');
		};
	}, []);
	return <li>big - 2121react</li>;
}

const root = ReactDOM.createRoot(document.querySelector('#root'));

root.render(<App />);
